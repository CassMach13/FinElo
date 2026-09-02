import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReconciliationResolutionModal,
  type ReconciliationResolutionPayload,
} from './ReconciliationResolutionModal';
import {
  computeReconciliation,
  listarResolucoesAtivas,
  novaIdempotencyKey,
  resolveComRetrySeguro,
  reverseReconciliation,
  type ReconciliationSnapshot,
} from '../../services/cardReconciliationService';
import type { ResolutionKind } from '../../domain/credit-card/twoLedgerBalance';
import {
  abrirIntencao,
  aplicarResultado,
  iniciarEnvio,
  podeEnviar,
  precisaRecarregar,
  type Intencao,
} from '../../domain/credit-card/reconciliationIntent';

/**
 * O fluxo de conciliar uma competência, do cálculo à confirmação.
 *
 * Este componente existe para que o modal continue puro: ele decide o que
 * mostrar, aqui é onde se fala com o servidor.
 *
 * Duas regras que vêm de comportamento medido, não de preferência:
 *
 * 1. O CÁLCULO SÓ ACONTECE AQUI, ao abrir. Ele leva alguns segundos, e não tem
 *    por que rodar a cada renderização do dashboard.
 *
 * 2. A CHAVE DE IDEMPOTÊNCIA É GERADA UMA VEZ por intenção e repetida em toda
 *    tentativa. Uma resolução concorrente pode devolver timeout ao cliente
 *    DEPOIS de gravar; gerar chave nova no retry criaria a segunda resolução.
 */

export interface ReconciliationFlowProps {
  accountId: string;
  /** Competência a conciliar. Explícita: o modal nunca a deduz de estado global. */
  referenceMonth: string;
  competenceLabel?: string;
  onClose: () => void;
  /** Chamado quando algo mudou de fato, para as superfícies recarregarem. */
  onResolved?: () => void;
}

type Fase =
  | { nome: 'calculando' }
  | { nome: 'pronto'; snapshot: ReconciliationSnapshot }
  | { nome: 'erro'; motivo: string }
  | { nome: 'concluido'; texto: string };

const money = (cents: number): string =>
  (Math.abs(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function ReconciliationFlow({
  accountId,
  referenceMonth,
  competenceLabel,
  onClose,
  onResolved,
}: ReconciliationFlowProps) {
  const [fase, setFase] = useState<Fase>({ nome: 'calculando' });
  const [ativas, setAtivas] = useState<
    Array<{ id: string; resolution: ResolutionKind; resolvedAmount: number | null }>
  >([]);

  /**
   * A intenção corrente. Vive num ref porque a chave não pode ser recriada por
   * uma re-renderização — é exatamente isso que a tornaria inútil. A regra de
   * quando ela nasce, sobrevive e morre está em `reconciliationIntent`, testada
   * sem renderizar nada.
   */
  const intencao = useRef<Intencao | null>(null);
  const [, forcarRender] = useState(0);
  const atual = intencao.current;
  const gravando = atual?.enviando ?? false;
  const aviso = atual?.aviso ?? null;

  const carregar = useCallback(async () => {
    setFase({ nome: 'calculando' });
    try {
      const [snapshot, resolucoes] = await Promise.all([
        computeReconciliation(accountId, referenceMonth),
        listarResolucoesAtivas(accountId, referenceMonth).catch(() => []),
      ]);
      setAtivas(resolucoes);
      setFase({ nome: 'pronto', snapshot });
    } catch (err) {
      setFase({ nome: 'erro', motivo: err instanceof Error ? err.message : String(err) });
    }
  }, [accountId, referenceMonth]);

  // Recalcula quando a competência muda: sem isto o modal poderia mostrar o
  // valor da competência anterior, que foi um defeito real em validação.
  useEffect(() => {
    intencao.current = null;
    forcarRender((n) => n + 1);
    void carregar();
  }, [carregar]);

  const confirmar = async (payload: ReconciliationResolutionPayload) => {
    intencao.current ??= abrirIntencao(novaIdempotencyKey);
    if (!podeEnviar(intencao.current)) return;

    intencao.current = iniciarEnvio(intencao.current);
    forcarRender((n) => n + 1);

    const resultado = await resolveComRetrySeguro({
      accountId,
      referenceMonth: payload.referenceMonth,
      resolution: payload.kind,
      idempotencyKey: intencao.current.idempotencyKey,
      authoritativeTotalCents: payload.authoritativeStatementTotalCents,
      authoritativeSource: payload.authoritativeSource,
    });

    intencao.current = aplicarResultado(intencao.current, resultado);
    forcarRender((n) => n + 1);

    if (resultado.status === 'confirmada') {
      onResolved?.();
      setFase({ nome: 'concluido', texto: intencao.current.aviso ?? 'Resolução registrada.' });
      return;
    }

    // Resposta perdida: a chave PERMANECE, para uma nova tentativa cair na mesma
    // linha. Recarregamos para mostrar o estado real em vez de adivinhar.
    if (precisaRecarregar(resultado)) await carregar();
  };

  const desfazer = async (resolutionId: string) => {
    if (intencao.current?.enviando) return;

    // Desfazer é outra intenção, com chave própria.
    const chave = novaIdempotencyKey();
    intencao.current = iniciarEnvio(
      intencao.current ?? abrirIntencao(() => chave)
    );
    forcarRender((n) => n + 1);

    const resultado = await reverseReconciliation(resolutionId, chave);
    intencao.current = { ...aplicarResultado(intencao.current, resultado), concluida: false };
    forcarRender((n) => n + 1);

    if (resultado.status === 'confirmada') {
      onResolved?.();
      await carregar();
      intencao.current = { ...intencao.current, aviso: 'Resolução desfeita.' };
      forcarRender((n) => n + 1);
    }
  };

  if (fase.nome === 'calculando') {
    return (
      <div role="status" aria-label="Calculando a diferença" className="p-6 text-center">
        <p className="text-sm text-slate-300">Calculando a diferença…</p>
      </div>
    );
  }

  if (fase.nome === 'erro') {
    return (
      <div role="alert" className="p-4 flex flex-col gap-3">
        <p className="text-sm text-rose-300">Não foi possível calcular: {fase.motivo}</p>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded bg-slate-700 text-slate-100">
            Fechar
          </button>
          <button
            type="button"
            onClick={() => void carregar()}
            className="px-3 py-1.5 rounded bg-slate-600 text-slate-100"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (fase.nome === 'concluido') {
    return (
      <div role="status" className="p-4 flex flex-col gap-4">
        <p className="text-sm text-emerald-300">{fase.texto}</p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded bg-slate-700 text-slate-100">
            Fechar
          </button>
        </div>
      </div>
    );
  }

  const { snapshot } = fase;

  return (
    <div className="flex flex-col">
      <ReconciliationResolutionModal
        referenceMonth={referenceMonth}
        competenceLabel={competenceLabel}
        unresolvedDeltaCents={snapshot.deltaCents}
        onCancel={onClose}
        onConfirm={(p) => void confirmar(p)}
        busy={gravando}
        aviso={aviso}
      />

      {ativas.length > 0 && (
        <div className="px-4 pb-4 border-t border-white/10 pt-3 flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Resoluções registradas nesta competência
          </p>
          {ativas.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-300">
                {r.resolvedAmount == null ? 'Valor oficial informado' : money(Math.round(r.resolvedAmount * 100))}
              </span>
              <button
                type="button"
                disabled={gravando}
                onClick={() => void desfazer(r.id)}
                className="px-2.5 py-1 rounded bg-slate-700 text-slate-100 text-xs disabled:opacity-40"
              >
                Desfazer
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
