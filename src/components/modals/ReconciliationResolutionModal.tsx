import { useMemo, useState } from 'react';
import {
  describeDelta,
  resolutionOptionsForDelta,
  type ResolutionOption,
} from '../../domain/credit-card/reconciliationResolutionOptions';
import type { AuthoritativeSource, ResolutionKind } from '../../domain/credit-card/twoLedgerBalance';

/**
 * Classificação de uma diferença de reconciliação.
 *
 * Duas decisões de desenho, ambas vindas de problemas observados antes:
 *
 * 1. A competência chega por PROP, sempre. O modal não lê nada de estado
 *    compartilhado com outra aba — foi assim que um submodal ficou exibindo a
 *    competência anterior durante a validação em staging.
 *
 * 2. Escolher uma opção não grava. Abre um segundo passo que repete competência,
 *    valor, classificação e efeito esperado, e só ele persiste. A investigação do
 *    fluxo de confirmação mostrou como essa distinção fica ambígua quando o
 *    primeiro botão parece final.
 */

export interface ReconciliationResolutionPayload {
  referenceMonth: string;
  kind: ResolutionKind;
  resolvedAmountCents: number | null;
  authoritativeStatementTotalCents?: number;
  authoritativeSource?: AuthoritativeSource;
}

export interface ReconciliationResolutionModalProps {
  /** Competência sendo resolvida. Explícita de propósito. */
  referenceMonth: string;
  /** Rótulo amigável da competência, quando houver. */
  competenceLabel?: string;
  /** Diferença assinada ainda não reconciliada, em centavos. */
  unresolvedDeltaCents: number;
  onCancel: () => void;
  /** Chamado UMA vez, só depois da confirmação final. */
  onConfirm: (payload: ReconciliationResolutionPayload) => void;
}

const money = (cents: number): string =>
  (Math.abs(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const FONTES: Array<{ value: AuthoritativeSource; label: string }> = [
  { value: 'bank_app', label: 'Aplicativo do banco' },
  { value: 'bank_pdf', label: 'PDF da fatura' },
  { value: 'bank_api', label: 'Integração com o banco' },
  { value: 'user_declared', label: 'Informado por mim' },
];

export function ReconciliationResolutionModal({
  referenceMonth,
  competenceLabel,
  unresolvedDeltaCents,
  onCancel,
  onConfirm,
}: ReconciliationResolutionModalProps) {
  const [escolhida, setEscolhida] = useState<ResolutionOption | null>(null);
  const [totalOficial, setTotalOficial] = useState('');
  const [fonte, setFonte] = useState<AuthoritativeSource>('bank_app');

  const opcoes = useMemo(
    () => resolutionOptionsForDelta(unresolvedDeltaCents),
    [unresolvedDeltaCents]
  );
  const descricao = useMemo(() => describeDelta(unresolvedDeltaCents), [unresolvedDeltaCents]);
  const rotulo = competenceLabel || referenceMonth;

  const oficialCents = Math.round((Number(totalOficial.replace(',', '.')) || 0) * 100);
  const oficialValido = !escolhida?.requiresAuthoritativeTotal || oficialCents > 0;

  if (opcoes.length === 0) {
    return (
      <div role="dialog" aria-label="Conciliação" className="p-4">
        <p className="text-sm text-slate-300">{descricao.resumo}</p>
        <button type="button" onClick={onCancel} className="mt-4 px-3 py-1.5 rounded bg-slate-700 text-slate-100">
          Fechar
        </button>
      </div>
    );
  }

  // ---- passo 2: confirmação. Só este passo persiste. ----
  if (escolhida) {
    return (
      <div role="dialog" aria-label="Confirmar esta resolução" className="p-4 flex flex-col gap-4">
        <h2 className="text-base font-semibold text-slate-100">Confirmar esta resolução</h2>

        <dl className="text-sm flex flex-col gap-1.5">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">Competência</dt>
            <dd className="text-slate-100 font-medium tabular-nums">{rotulo}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">Diferença</dt>
            <dd className="text-slate-100 font-medium tabular-nums">
              {descricao.sinal === 'negativa' ? '−' : '+'}
              {money(unresolvedDeltaCents)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">Classificação</dt>
            <dd className="text-slate-100 font-medium text-right">{escolhida.label}</dd>
          </div>
          {escolhida.requiresAuthoritativeTotal && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-400">Valor oficial</dt>
              <dd className="text-slate-100 font-medium tabular-nums">{money(oficialCents)}</dd>
            </div>
          )}
        </dl>

        <p className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-400/30 rounded p-3">
          {escolhida.consequence}
        </p>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setEscolhida(null)}
            className="px-3 py-1.5 rounded bg-slate-700 text-slate-100"
          >
            Voltar
          </button>
          <button
            type="button"
            disabled={!oficialValido}
            onClick={() =>
              onConfirm({
                referenceMonth,
                kind: escolhida.kind,
                resolvedAmountCents: escolhida.requiresAuthoritativeTotal
                  ? null
                  : unresolvedDeltaCents,
                ...(escolhida.requiresAuthoritativeTotal
                  ? { authoritativeStatementTotalCents: oficialCents, authoritativeSource: fonte }
                  : {}),
              })
            }
            className="px-3 py-1.5 rounded bg-emerald-600 text-white font-semibold disabled:opacity-40"
          >
            Confirmar resolução
          </button>
        </div>
      </div>
    );
  }

  // ---- passo 1: escolha. Nada é gravado aqui. ----
  return (
    <div role="dialog" aria-label="Conciliar diferença" className="p-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-slate-100">
          Conciliar diferença — {rotulo}
        </h2>
        <p className="text-sm text-slate-400">{descricao.resumo}</p>
      </div>

      <ul className="flex flex-col gap-2">
        {opcoes.map((opcao) => (
          <li key={opcao.kind}>
            <button
              type="button"
              onClick={() => setEscolhida(opcao)}
              className="w-full text-left rounded border border-white/10 bg-white/5 hover:bg-white/10 p-3 flex flex-col gap-1"
            >
              <span className="text-sm font-medium text-slate-100">{opcao.label}</span>
              <span className="text-xs text-slate-400">{opcao.consequence}</span>
            </button>
          </li>
        ))}
      </ul>

      {/* Campos do valor oficial ficam sempre visíveis para quem escolher essa via. */}
      <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
        <label className="text-xs uppercase tracking-wide text-slate-400" htmlFor="total-oficial">
          Valor oficial da fatura, se for informar
        </label>
        <div className="flex gap-2">
          <input
            id="total-oficial"
            inputMode="decimal"
            value={totalOficial}
            onChange={(e) => setTotalOficial(e.target.value)}
            placeholder="0,00"
            className="flex-1 rounded bg-slate-800 border border-white/10 px-2 py-1.5 text-sm text-slate-100"
          />
          <select
            aria-label="Procedência do valor oficial"
            value={fonte}
            onChange={(e) => setFonte(e.target.value as AuthoritativeSource)}
            className="rounded bg-slate-800 border border-white/10 px-2 py-1.5 text-sm text-slate-100"
          >
            {FONTES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded bg-slate-700 text-slate-100">
          Cancelar
        </button>
      </div>
    </div>
  );
}
