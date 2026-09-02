import React from 'react';
import { Account } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import type { NativeBankConfig } from '../../services/parsers/nativeBankParsers';

export interface AccountCardDisplayData {
  isCreditCard: boolean;
  currentBalance: number;
  faturaAtual: number;
  limite: number;
  limiteUsadoPct: number;
  limiteDisponivel: number;
  barColor: string;
  diaFecha: number;
  diaVence: number;
  diasParaFechar: number;
  diasParaVencer: number;
  awaitingMotorSnapshotUi: boolean;
  /** Competência exibida já venceu e segue em aberto. */
  faturaVencida?: boolean;
  /** Vencimento da competência exibida (AAAA-MM-DD), não o próximo genérico. */
  faturaDueDateIso?: string | null;
  /** Competência exibida, em MM/AAAA. */
  faturaCompetenceLabel?: string | null;
  /** «Fatura atual» ou «Fatura em aberto», conforme o status. */
  faturaTitulo?: string;
  /**
   * Livro 2. Existe conciliação pendente nesta conta — diferença observada cuja
   * natureza ainda não foi provada. NUNCA é dívida, pagamento nem crédito, e não
   * pode ser somada a `faturaAtual` nem ao limite.
   */
  reconciliacaoPendente?: boolean;
  /** Saldo do livro de reconciliação. Informativo; não move nenhum número econômico. */
  reconciliacaoSaldo?: number;
  /**
   * A competência que tem a diferença — não necessariamente a fatura exibida.
   * Na cadeia real dos R$ 0,22 a diferença mora em 2024-12 enquanto o destaque
   * é outro mês.
   */
  reconciliacaoReferenceMonth?: string | null;
  /**
   * Ha resolucao gravada nesta conta. O acesso ao fluxo continua mesmo sem
   * diferenca pendente — senao o usuario resolve e fica sem caminho para
   * DESFAZER.
   */
  reconciliacaoResolvida?: boolean;
}

/** DD/MM a partir de AAAA-MM-DD, sem passar por Date (evita deslocamento de fuso). */
const isoParaDiaMes = (iso?: string | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  return m ? `${m[3]}/${m[2]}` : '';
};

interface AccountBalanceCardProps {
  account: Account;
  bankConfig?: NativeBankConfig;
  display: AccountCardDisplayData;
  /** Nome do responsável quando a conta pertence a outro membro do plano família. */
  ownerLabel?: string;
  onEdit: () => void;
  onOpenHistory?: () => void;
  onPayInvoice?: () => void;
  /** Abre o fluxo de conciliacao da competencia que tem a diferenca. */
  onOpenReconciliation?: (referenceMonth: string) => void;
}

const AccountBalanceCard: React.FC<AccountBalanceCardProps> = ({
  account,
  bankConfig,
  display,
  ownerLabel,
  onEdit,
  onOpenHistory,
  onPayInvoice,
  onOpenReconciliation,
}) => {
  const {
    isCreditCard,
    currentBalance,
    faturaAtual,
    limite,
    limiteUsadoPct,
    limiteDisponivel,
    barColor,
    diaFecha,
    diaVence,
    diasParaFechar,
    diasParaVencer,
    faturaVencida = false,
    faturaDueDateIso = null,
    faturaTitulo = 'Fatura atual',
    awaitingMotorSnapshotUi,
    reconciliacaoPendente = false,
    reconciliacaoReferenceMonth = null,
    reconciliacaoResolvida = false,
  } = display;

  const balanceColor =
    currentBalance < 0 ? 'text-danger' : currentBalance > 0 ? 'text-accent' : 'text-light';

  return (
    <div
      className={`relative overflow-hidden group cursor-pointer transition-all duration-300 hover:scale-[1.02] active:scale-[0.99] rounded-2xl shadow-xl border-l-4 flex flex-col ${
        isCreditCard
          ? 'bg-gradient-to-br from-slate-900 to-slate-800 border-indigo-500 shadow-indigo-500/10 p-3.5 sm:p-4 w-fit max-w-full self-start'
          : 'bg-gradient-to-br from-secondary to-slate-800 border-accent shadow-accent/10 p-4 min-h-[132px]'
      }`}
      onClick={onEdit}
      title={`Clique para editar ${account.Nome_Conta}`}
    >
      <div
        className={`absolute -right-6 -bottom-6 w-28 h-28 rounded-full opacity-[0.04] blur-2xl pointer-events-none ${
          isCreditCard ? 'bg-indigo-400' : 'bg-accent'
        }`}
      />

      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 z-20">
        <div className="bg-white/10 backdrop-blur-md p-2 rounded-xl border border-white/10 shadow-lg">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
        </div>
      </div>

      <div className={`z-10 flex flex-col flex-1 ${isCreditCard ? 'gap-2 w-full min-w-0' : 'gap-3'}`}>
        {/* Cabeçalho com logo maior */}
        <div className="flex items-center gap-3 pr-8 min-w-0">
          {bankConfig?.logoUrl ? (
            <div className="w-11 h-11 shrink-0 rounded-xl bg-white/10 p-1.5 flex items-center justify-center border border-white/10 shadow-inner">
              <img
                src={bankConfig.logoUrl}
                alt={bankConfig.name}
                className="w-full h-full object-contain"
              />
            </div>
          ) : account.Tipo_Conta === 'Dinheiro em Espécie' ? (
            <div className="w-11 h-11 shrink-0 rounded-xl bg-emerald-500/15 p-1.5 flex items-center justify-center border border-emerald-500/25 shadow-inner">
              <img
                src="/bank-logos/cash.svg"
                alt="Dinheiro em espécie"
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-11 h-11 shrink-0 rounded-xl bg-white/8 flex items-center justify-center text-lg border border-white/10">
              {isCreditCard ? '💳' : '🏦'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3
              className="text-white text-sm font-bold uppercase tracking-wide truncate leading-tight"
              title={account.Nome_Conta}
            >
              {account.Nome_Conta}
            </h3>
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block truncate">
              {account.Tipo_Conta}
            </span>
            {ownerLabel ? (
              <span
                className="text-[10px] text-slate-400 font-semibold normal-case tracking-normal block truncate mt-0.5"
                title={`Conta de ${ownerLabel}`}
              >
                de {ownerLabel}
              </span>
            ) : null}
          </div>
        </div>

        {isCreditCard ? (
          <div className="space-y-2 flex-1 w-full min-w-0">
            {limite > 0 ? (
              <>
                {awaitingMotorSnapshotUi ? (
                  <div className="space-y-2 w-full" aria-busy="true" aria-live="polite">
                    <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden">
                      <div className="h-full w-[32%] rounded-full bg-slate-600/40 animate-pulse" />
                    </div>
                    <div className="h-8 rounded-lg bg-white/5 animate-pulse" />
                    <p className="text-[9px] text-slate-500 text-center">Carregando limite e fatura…</p>
                  </div>
                ) : (
                  <>
                    <div className="w-full min-w-0">
                      <div className="flex justify-between items-center gap-2 mb-1">
                        <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wide shrink-0">
                          Uso do limite
                        </span>
                        <span
                          className={`text-[10px] font-black tabular-nums shrink-0 ${
                            limiteUsadoPct > 90 ? 'text-red-400' : 'text-indigo-300'
                          }`}
                        >
                          {limiteUsadoPct.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                          %
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                        <div
                          className={`h-full max-w-full rounded-full transition-all duration-700 ${barColor}`}
                          style={{ width: `${limiteUsadoPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Faixa justa ao conteúdo — sem flex-1 esticando colunas vazias */}
                    <div className="rounded-lg bg-white/[0.06] border border-white/8 px-2 py-0.5 w-fit max-w-full">
                      <div className="flex items-center gap-2.5">
                        <div className="flex flex-col gap-px shrink-0">
                          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wide leading-none whitespace-nowrap">
                            Disponível
                          </p>
                          <p className="text-sm sm:text-[15px] font-black text-emerald-400 tabular-nums leading-none whitespace-nowrap">
                            {formatCurrency(limiteDisponivel)}
                          </p>
                        </div>
                        <div className="w-px h-8 bg-white/10 shrink-0" aria-hidden />
                        <div className="flex flex-col gap-px shrink-0">
                          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wide leading-none whitespace-nowrap flex items-center gap-1">
                            {faturaTitulo}
                            {/* O selo de vencida vem primeiro: e o estado principal. O de
                                conciliacao vem depois, como informacao secundaria. Sao dimensoes
                                diferentes, e uma nao substitui a outra. */}
                            {faturaVencida && (
                              <span className="text-[9px] font-black px-1 py-px rounded bg-rose-500/20 text-rose-300 border border-rose-400/40 tracking-normal">
                                VENCIDA
                              </span>
                            )}
                            {reconciliacaoPendente && (
                              <span
                                title="Há diferença entre o extrato e os pagamentos ainda não conciliada. Não é dívida nem crédito."
                                className="text-[9px] font-semibold px-1 py-px rounded bg-amber-500/15 text-amber-300 border border-amber-400/30 tracking-normal"
                              >
                                A CONCILIAR
                              </span>
                            )}
                            {(reconciliacaoPendente || reconciliacaoResolvida) && reconciliacaoReferenceMonth && onOpenReconciliation && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenReconciliation(reconciliacaoReferenceMonth);
                                }}
                                className="text-[9px] font-semibold px-1 py-px rounded bg-amber-500/25 hover:bg-amber-500/40 text-amber-100 border border-amber-400/40 tracking-normal transition-colors"
                              >
                                {reconciliacaoPendente ? 'Ver diferença' : 'Conciliação'}
                              </button>
                            )}
                          </p>
                          <p className="text-sm sm:text-[15px] font-black text-rose-400 tabular-nums leading-none whitespace-nowrap">
                            {formatCurrency(faturaAtual)}
                          </p>
                        </div>
                        {(onOpenHistory || (faturaAtual > 0 && onPayInvoice)) && (
                          <div className="flex items-center gap-1 shrink-0 border-l border-white/10 pl-2.5 ml-0.5">
                            {onOpenHistory && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenHistory();
                                }}
                                className="bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 text-[10px] font-bold px-2 py-0.5 rounded-md border border-cyan-500/30 transition-all whitespace-nowrap"
                              >
                                Histórico
                              </button>
                            )}
                            {faturaAtual > 0 && onPayInvoice && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPayInvoice();
                                }}
                                className="bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-md border border-emerald-500/30 transition-all whitespace-nowrap"
                              >
                                Pagar
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {faturaVencida && faturaDueDateIso ? (
                      /* Fatura vencida: mostra o vencimento real dela, sem contagem
                         regressiva do ciclo seguinte, que descreveria outra fatura. */
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span
                          className="text-rose-300 font-bold px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-400/30 whitespace-nowrap"
                          title={`Venceu em ${isoParaDiaMes(faturaDueDateIso)}`}
                        >
                          Venceu em {isoParaDiaMes(faturaDueDateIso)}
                        </span>
                      </div>
                    ) : (
                      (diaFecha > 0 || diaVence > 0) && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                          {diaFecha > 0 && (
                            <span className="text-amber-400/90 font-medium whitespace-nowrap">
                              Fecha {diasParaFechar}d · dia {diaFecha}
                            </span>
                          )}
                          {diaVence > 0 && (
                            <span
                              className="text-cyan-300/95 font-bold px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-400/20 whitespace-nowrap"
                              title={
                                faturaDueDateIso
                                  ? `Vence em ${isoParaDiaMes(faturaDueDateIso)}`
                                  : `Vencimento dia ${diaVence}`
                              }
                            >
                              Vence {diasParaVencer}d · {isoParaDiaMes(faturaDueDateIso) || `dia ${diaVence}`}
                            </span>
                          )}
                        </div>
                      )
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <span className="text-xl font-black text-rose-400 tabular-nums">
                  {formatCurrency(faturaAtual)}
                </span>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold flex items-center gap-1.5">
                  {faturaTitulo}
                  {/* O selo de vencida vem primeiro: e o estado principal. O de
                      conciliacao vem depois, como informacao secundaria. Sao dimensoes
                      diferentes, e uma nao substitui a outra. */}
                  {faturaVencida && (
                    <span className="text-[9px] font-black px-1 py-px rounded bg-rose-500/20 text-rose-300 border border-rose-400/40 tracking-normal">
                      VENCIDA
                    </span>
                  )}
                  {reconciliacaoPendente && (
                    <span
                      title="Há diferença entre o extrato e os pagamentos ainda não conciliada. Não é dívida nem crédito."
                      className="text-[9px] font-semibold px-1 py-px rounded bg-amber-500/15 text-amber-300 border border-amber-400/30 tracking-normal"
                    >
                      A CONCILIAR
                    </span>
                  )}
                  {(reconciliacaoPendente || reconciliacaoResolvida) && reconciliacaoReferenceMonth && onOpenReconciliation && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenReconciliation(reconciliacaoReferenceMonth);
                      }}
                      className="text-[9px] font-semibold px-1 py-px rounded bg-amber-500/25 hover:bg-amber-500/40 text-amber-100 border border-amber-400/40 tracking-normal transition-colors"
                    >
                      {reconciliacaoPendente ? 'Ver diferença' : 'Conciliação'}
                    </button>
                  )}
                </p>
                <div className="flex flex-wrap gap-2 w-full mt-1 justify-end">
                  <button
                    type="button"
                    className="py-1.5 px-3 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded-lg text-[10px] font-black uppercase transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit();
                    }}
                  >
                    Configurar limite
                  </button>
                  {onOpenHistory && (
                    <button
                      type="button"
                      className="py-1.5 px-3 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/25 rounded-lg text-[10px] font-black uppercase transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenHistory();
                      }}
                    >
                      Histórico
                    </button>
                  )}
                  {faturaAtual > 0 && onPayInvoice && (
                    <button
                      type="button"
                      className="py-1.5 px-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-black uppercase transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPayInvoice();
                      }}
                    >
                      Pagar
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-auto flex flex-col items-end pt-1">
            <span className={`text-xl sm:text-2xl font-black tracking-tight tabular-nums ${balanceColor}`}>
              {formatCurrency(currentBalance)}
            </span>
            <p className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-bold mt-0.5">
              Saldo líquido
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountBalanceCard;
