import React from 'react';
import type { CardDiagnostic } from '../../domain/credit-card/cardDiagnostics';

/**
 * «Revisar cartão» — por que o cartão pode não estar batendo.
 *
 * A tela responde quatro perguntas por item, nessa ordem: o que encontramos,
 * quanto representa, em qual fatura, e o que dá para fazer. Nada aqui corrige
 * dado sozinho: a ação leva o usuário ao lugar onde ele já pode olhar e decidir.
 *
 * O vocabulário do domínio fica de fora. Competência, carry, suspense e livro 2
 * são como o motor pensa; o usuário só precisa de fatura, valor e mês.
 */

interface CardDiagnosticsModalProps {
  accountName: string;
  diagnosticos: CardDiagnostic[];
  onClose: () => void;
  /** Leva ao histórico de faturas, opcionalmente já na competência do item. */
  onOpenHistory?: (referenceMonth?: string) => void;
  /** Abre o fluxo de conciliação existente — o mesmo do «Ver diferença». */
  onOpenReconciliation?: (referenceMonth: string) => void;
}

const ROTULO_ACAO: Record<CardDiagnostic['action'], string> = {
  abrir_historico: 'Ver essas faturas',
  abrir_fatura: 'Ver a fatura',
  ver_diferenca: 'Ver diferença',
};

const CardDiagnosticsModal: React.FC<CardDiagnosticsModalProps> = ({
  accountName,
  diagnosticos,
  onClose,
  onOpenHistory,
  onOpenReconciliation,
}) => {
  const total = diagnosticos.length;

  const executar = (item: CardDiagnostic) => {
    const mes = item.competences[0];
    if (item.action === 'ver_diferenca' && mes && onOpenReconciliation) {
      onOpenReconciliation(mes);
      return;
    }
    onOpenHistory?.(item.competences.length === 1 ? mes : undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">Revisar cartão</h2>
            <p className="mt-0.5 truncate text-xs text-slate-400">{accountName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-lg px-2 py-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
          {total === 0 ? (
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-4">
              <p className="text-sm font-semibold text-emerald-200">Cartão consistente</p>
              <p className="mt-1 text-[13px] leading-relaxed text-emerald-100/80">
                Não encontramos nada que precise de revisão neste cartão.
              </p>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-slate-400">
                {total === 1
                  ? 'Encontramos 1 informação que pode precisar de revisão.'
                  : `Encontramos ${total} informações que podem precisar de revisão.`}
              </p>

              {diagnosticos.map((item, i) => {
                const atencao = item.severity === 'atencao';
                return (
                  <div
                    key={`${item.code}-${item.severity}-${i}`}
                    className={`rounded-xl border p-4 ${
                      atencao
                        ? 'border-amber-400/30 bg-amber-500/10'
                        : 'border-white/10 bg-white/[0.04]'
                    }`}
                  >
                    <p
                      className={`text-sm font-semibold ${
                        atencao ? 'text-amber-100' : 'text-slate-200'
                      }`}
                    >
                      {item.title}
                    </p>
                    <p
                      className={`mt-1.5 text-[13px] leading-relaxed ${
                        atencao ? 'text-amber-100/85' : 'text-slate-300/85'
                      }`}
                    >
                      {item.message}
                    </p>
                    {item.competenceLabel ? (
                      <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-400">
                        {item.competenceLabel}
                      </p>
                    ) : null}
                    {(onOpenHistory || onOpenReconciliation) && (
                      <button
                        type="button"
                        onClick={() => executar(item)}
                        className="mt-3 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                      >
                        {ROTULO_ACAO[item.action]}
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-white/10 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default CardDiagnosticsModal;
