import React from 'react';
import Card from '../ui/Card';
import { formatCurrency } from '../../utils/formatters';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import type { CurrentNetWorthPosition } from '../../domain/dashboard/currentNetWorth';

export interface CurrentNetWorthCardProps {
  position: CurrentNetWorthPosition | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  scopeLabel: string;
  onRetry: () => void;
}
const money = (value: number | null | undefined) => value == null ? '—' : formatCurrency(value / 100);

export default function CurrentNetWorthCard({ position, status, scopeLabel, onRetry }: CurrentNetWorthCardProps) {
  const loading = status === 'loading' || status === 'idle';
  const p = loading ? null : position;
  const rows = [
    { label: 'Saldo bancário', value: p?.bankBalanceCents, detail: 'Saldo efetivo das contas, inclusive quando negativo.' },
    { label: 'Benefícios de uso restrito', value: p?.restrictedBenefitsCents, detail: 'Separados do dinheiro bancário; não compensam faturas vencidas.' },
    { label: 'Investimentos', value: p?.investmentsCents, detail: 'Últimas posições registradas de cada titular.' },
    { label: 'Bens patrimoniais líquidos', value: p?.assetsNetCents,
      detail: p?.assetsGrossCents != null && p.assetFinancingCents != null
        ? money(p.assetsGrossCents) + ' em bens − ' + money(p.assetFinancingCents) + ' em financiamentos.'
        : 'Valor dos bens menos o financiamento restante.' },
    { label: 'Obrigações de cartões', value: p?.cardObligationsCents == null ? null : -p.cardObligationsCents,
      detail: 'Vencidas: ' + money(p?.overdueCardObligationsCents) + ' · A vencer: ' + money(p?.upcomingCardObligationsCents) + '.' },
    ...(p?.provenCardCreditCents ? [{ label: 'Créditos comprovados em cartões', value: p.provenCardCreditCents,
      detail: 'Crédito remanescente reconhecido; não é saldo bancário.' }] : []),
  ];
  return (
    <Card className="flex flex-col h-full sm:col-span-2 lg:col-span-3">
      <section aria-label="Posição patrimonial atual" aria-busy={loading} data-net-worth-v2="">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-light">Patrimônio líquido</h3>
          <p className="text-xs text-slate-300">{scopeLabel}</p>
        </div>
        <p className="text-xs text-slate-300 mt-1">
          {p ? 'Posição atual em ' + formatDateOnlyPtBr(p.asOf) : 'Posição atual'}
        </p>
        <p data-net-worth-total="" className={`mt-3 text-2xl sm:text-3xl font-bold tabular-nums ${(p?.netWorthCents ?? 0) < 0 ? 'text-red-300' : 'text-light'}`}>
          {money(p?.netWorthCents)}
        </p>
        {loading ? <p role="status" className="mt-2 text-sm text-slate-300">Carregando a posição patrimonial atual…</p> : null}
        {status === 'error' ? (
          <div role="alert" className="mt-3 text-sm text-slate-200">
            <p>Não foi possível concluir a leitura da posição. Os totais estão indisponíveis.</p>
            <button type="button" onClick={onRetry} className="mt-2 rounded-lg border border-slate-400 px-3 py-2 text-sm font-semibold text-light hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              Tentar novamente
            </button>
          </div>
        ) : null}
        {p?.completeness === 'partial' ? (
          <p role="status" className="mt-3 text-sm text-slate-200">Há fontes incompletas. Totais que dependem delas ficam indisponíveis.</p>
        ) : null}
        <dl className="mt-5 divide-y divide-white/10">
          {rows.map((row) => (
            <div key={row.label} className="py-3 first:pt-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
              <dt className="text-sm text-light">{row.label}</dt>
              <dd className={`text-right text-sm font-semibold tabular-nums ${(row.value ?? 0) < 0 ? 'text-red-300' : 'text-light'}`}>{money(row.value)}</dd>
              <dd className="col-span-2 text-xs leading-relaxed text-slate-300">{row.detail}</dd>
            </div>
          ))}
        </dl>
        <dl className="mt-2 border-t border-white/20 pt-4">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-sm font-semibold text-light">Disponível após obrigações vencidas</dt>
            <dd data-available-after-overdue="" className={`text-base font-bold tabular-nums ${(p?.availableAfterOverdueCents ?? 0) < 0 ? 'text-red-300' : 'text-light'}`}>{money(p?.availableAfterOverdueCents)}</dd>
          </div>
          <dd className="mt-1 text-xs leading-relaxed text-slate-300">Saldo bancário menos faturas vencidas sem pagamento reconhecido. Não altera o saldo das contas.</dd>
        </dl>
        {p?.reconciliationPending ? <p className="mt-4 text-xs text-slate-200">Conciliação pendente: diferenças sem resolução econômica ficam fora dos valores financeiros.</p> : null}
        {p && p.archivedAccountsWithPosition > 0 ? <p className="mt-3 text-xs text-slate-300">Inclui contas arquivadas com saldo ou obrigação registrada.</p> : null}
        {p?.cards.length ? (
          <details className="mt-4 text-xs text-slate-300">
            <summary className="cursor-pointer rounded py-1 text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Ver cartões e origem dos valores</summary>
            <ul className="mt-2 space-y-2">
              {p.cards.map((card) => <li key={card.accountId}>
                {card.accountName}: {money(card.amounts?.totalRecognizedCents)} em obrigações.
                {' '}{card.completeness === 'complete' ? 'Compras, parcelas e pagamentos registrados.' : 'Dados insuficientes para concluir o passivo.'}
                {card.origin.confirmations > 0 ? ' Inclui confirmações de pagamento.' : ''}
              </li>)}
            </ul>
          </details>
        ) : null}
        <p className="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed text-slate-300">
          A posição atual independe do período operacional selecionado. Comparação histórica de patrimônio indisponível até haver histórico temporal confiável.
        </p>
      </section>
    </Card>
  );
}
