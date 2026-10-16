import React from 'react';
import Card from '../ui/Card';
import { ChevronDownIcon, InformationCircleIcon } from '../ui/icons';
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

interface SummaryRow {
  label: string;
  value: number | null | undefined;
  detail: string;
  color: string;
  marker: string;
  support?: boolean;
}

export default function CurrentNetWorthCard({ position, status, scopeLabel, onRetry }: CurrentNetWorthCardProps) {
  const loading = status === 'loading' || status === 'idle';
  const p = loading ? null : position;
  const rows: SummaryRow[] = [
    { label: 'Saldo bancário', value: p?.bankBalanceCents, detail: 'Saldo efetivo das contas, inclusive quando negativo.',
      color: 'text-cyan-300', marker: 'bg-cyan-400' },
    { label: 'Benefícios de uso restrito', value: p?.restrictedBenefitsCents, detail: 'Separados do dinheiro bancário; não compensam faturas vencidas.',
      color: 'text-teal-300', marker: 'bg-teal-400' },
    { label: 'Investimentos', value: p?.investmentsCents, detail: 'Últimas posições registradas de cada titular.',
      color: 'text-violet-300', marker: 'bg-violet-400' },
    { label: 'Bens patrimoniais líquidos', value: p?.assetsNetCents,
      color: 'text-amber-300', marker: 'bg-amber-400',
      detail: p?.assetsGrossCents != null && p.assetFinancingCents != null
        ? money(p.assetsGrossCents) + ' em bens − ' + money(p.assetFinancingCents) + ' em financiamentos.'
        : 'Valor dos bens menos o financiamento restante.' },
    { label: 'Obrigações de cartões', value: p?.cardObligationsCents == null ? null : -p.cardObligationsCents,
      color: 'text-rose-300', marker: 'bg-rose-400', support: true,
      detail: 'Vencidas: ' + money(p?.overdueCardObligationsCents) + ' · A vencer: ' + money(p?.upcomingCardObligationsCents) + '.' },
    ...(p?.provenCardCreditCents ? [{ label: 'Créditos comprovados em cartões', value: p.provenCardCreditCents,
      color: 'text-teal-300', marker: 'bg-teal-400',
      detail: 'Crédito remanescente reconhecido; não é saldo bancário.' }] : []),
  ];
  return (
    <Card className="flex flex-col h-full sm:col-span-2 lg:col-span-3">
      <section aria-label="Posição patrimonial atual" aria-busy={loading} data-net-worth-v2="">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-lg font-semibold text-light">Patrimônio líquido</h3>
          <p className="min-w-0 break-words text-xs text-slate-300">{scopeLabel}</p>
        </div>
        <p data-net-worth-total="" className={`mt-2 break-words text-3xl sm:text-4xl font-bold tracking-tight tabular-nums ${(p?.netWorthCents ?? 0) < 0 ? 'text-red-300' : 'text-cyan-300'}`}>
          {money(p?.netWorthCents)}
        </p>
        <p className="mt-2 text-xs text-slate-300">
          {p ? 'Posição atual em ' + formatDateOnlyPtBr(p.asOf) : 'Posição atual'}
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
          <p role="status" className="mt-3 text-sm text-amber-200">Há fontes incompletas. Totais que dependem delas ficam indisponíveis.</p>
        ) : null}
        <dl data-net-worth-components="" className="mt-6 divide-y divide-white/10 border-t border-white/10">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-3.5">
              <dt className={`flex min-w-0 items-baseline gap-2 text-sm font-medium leading-5 ${row.color}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${row.marker}`} />
                {row.label}
              </dt>
              <dd className={`text-right text-sm sm:text-base font-semibold tabular-nums ${(row.value ?? 0) < 0 ? 'text-red-300' : row.color}`}>{money(row.value)}</dd>
              {row.support ? <dd className="col-span-2 pl-3.5 text-xs leading-5 text-slate-300">{row.detail}</dd> : null}
            </div>
          ))}
        </dl>
        <dl className={`mt-3 border-y py-4 ${(p?.availableAfterOverdueCents ?? 0) < 0 ? 'border-rose-300/20 bg-rose-400/5' : 'border-white/10'}`}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <dt className="max-w-64 text-sm font-semibold leading-5 text-light">Disponível após obrigações vencidas</dt>
            <dd data-available-after-overdue="" className={`text-xl font-bold tabular-nums ${(p?.availableAfterOverdueCents ?? 0) < 0 ? 'text-red-300' : p?.availableAfterOverdueCents == null ? 'text-light' : 'text-emerald-300'}`}>{money(p?.availableAfterOverdueCents)}</dd>
          </div>
          {(p?.availableAfterOverdueCents ?? 0) < 0 ? <dd className="mt-2 text-xs font-medium text-rose-200">Saldo negativo após vencidas</dd> : null}
        </dl>
        {p?.reconciliationPending || (p && p.archivedAccountsWithPosition > 0) ? (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-5 text-slate-300">
            {p?.reconciliationPending ? <span>Conciliação pendente</span> : null}
            {p && p.archivedAccountsWithPosition > 0 ? <span>Contas arquivadas incluídas</span> : null}
          </div>
        ) : null}
        <details data-net-worth-details="" className="group mt-2 text-xs text-slate-300">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 font-medium text-light hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            {p?.cards.length ? 'Ver cartões e origem dos valores' : 'Como ler estes valores'}
            <span aria-hidden="true" className="shrink-0 transition-transform duration-200 motion-reduce:transition-none group-open:rotate-180"><ChevronDownIcon className="h-4 w-4" /></span>
          </summary>
          <div className="space-y-5 border-t border-white/10 py-4 leading-relaxed">
            {p?.cards.length ? (
              <ul className="space-y-4" aria-label="Cartões e origem dos valores">
                {p.cards.map((card) => <li key={card.accountId}>
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-light">
                    <span className="min-w-0 break-words font-medium">{card.accountName}:</span>
                    <span className="tabular-nums">{money(card.amounts?.totalRecognizedCents)} em obrigações.</span>
                  </div>
                  <p className="mt-1">{card.completeness === 'complete' ? 'Compras, parcelas e pagamentos registrados.' : 'Dados insuficientes para concluir o passivo.'}
                    {card.origin.confirmations > 0 ? ' Inclui confirmações de pagamento.' : ''}
                  </p>
                </li>)}
              </ul>
            ) : null}
            <dl className="space-y-3">
              {rows.filter((row) => !row.support).map((row) => <div key={row.label}>
                <dt className="font-medium text-slate-200">{row.label}</dt>
                <dd className="mt-0.5">{row.detail}</dd>
              </div>)}
              <div>
                <dt className="font-medium text-slate-200">Disponível após obrigações vencidas</dt>
                <dd className="mt-0.5">Saldo bancário menos faturas vencidas sem pagamento reconhecido. Não altera o saldo das contas.</dd>
              </div>
            </dl>
            {p?.reconciliationPending ? <p>Conciliação pendente: diferenças sem resolução econômica ficam fora dos valores financeiros.</p> : null}
            {p && p.archivedAccountsWithPosition > 0 ? <p>Inclui contas arquivadas com saldo ou obrigação registrada.</p> : null}
            <p>A posição atual independe do período operacional selecionado. Comparação histórica de patrimônio indisponível até haver histórico temporal confiável.</p>
          </div>
        </details>
        <p className="mt-1 flex items-start gap-2 text-xs leading-5 text-slate-300">
          <span aria-hidden="true" className="mt-0.5 shrink-0"><InformationCircleIcon className="h-4 w-4" /></span>
          Comparação histórica de patrimônio indisponível.
        </p>
      </section>
    </Card>
  );
}
