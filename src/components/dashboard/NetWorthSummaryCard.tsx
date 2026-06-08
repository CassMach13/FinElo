import React, { useMemo } from 'react';
import Card from '../ui/Card';
import { InformationCircleIcon, ArrowsUpDownIcon } from '../ui/icons';
import { formatCurrency } from '../../utils/formatters';
import PeriodCompareColumns from '../ui/PeriodCompareColumns';

export interface NetWorthBreakdown {
  total: number;
  accounts: number;
  investments: number;
  assetsNet: number;
  assetsGross: number;
  assetsDebts: number;
}

interface Segment {
  id: string;
  label: string;
  hint: string;
  liquidityTag: string;
  liquidityClass: string;
  amount: number;
  color: string;
  barColor: string;
  detail?: string;
}

export interface NetWorthCardComparison {
  periodLabel: string;
  breakdown: NetWorthBreakdown;
  deltaLabel: string;
  deltaTone?: 'positive' | 'negative' | 'neutral';
}

interface NetWorthSummaryCardProps extends NetWorthBreakdown {
  className?: string;
  compare?: NetWorthCardComparison;
  asOfLabel?: string;
  primaryPeriodLabel?: string;
}

const NetWorthSummaryCard: React.FC<NetWorthSummaryCardProps> = ({
  total,
  accounts,
  investments,
  assetsNet,
  assetsGross,
  assetsDebts,
  className = '',
  compare,
  asOfLabel,
  primaryPeriodLabel,
}) => {
  const segments: Segment[] = useMemo(() => {
    const list: Segment[] = [
      {
        id: 'accounts',
        label: 'Contas',
        hint: 'Corrente, poupança — uso imediato',
        liquidityTag: 'Liquidez imediata',
        liquidityClass: 'bg-cyan-500/15 text-cyan-300/90 border-cyan-500/25',
        amount: accounts,
        color: 'text-cyan-300',
        barColor: 'bg-cyan-500',
      },
      {
        id: 'investments',
        label: 'Investimentos',
        hint: 'Carteira Wealth — resgate depende do ativo',
        liquidityTag: 'Liquidez variável',
        liquidityClass: 'bg-violet-500/15 text-violet-300/90 border-violet-500/25',
        amount: investments,
        color: 'text-violet-300',
        barColor: 'bg-violet-500',
      },
      {
        id: 'assets',
        label: 'Bens patrimoniais',
        hint: 'Imóveis, veículos, arte — valor de mercado menos financiamento',
        liquidityTag: 'Baixa liquidez',
        liquidityClass: 'bg-amber-500/15 text-amber-200/90 border-amber-500/25',
        amount: assetsNet,
        color: 'text-amber-300',
        barColor: 'bg-amber-500',
        detail:
          assetsDebts > 0
            ? `${formatCurrency(assetsGross)} de valor de mercado − ${formatCurrency(assetsDebts)} em financiamentos`
            : assetsGross > 0
              ? `${formatCurrency(assetsGross)} em bens cadastrados`
              : undefined,
      },
    ];
    return list.filter((s) => s.amount !== 0 || s.id === 'accounts');
  }, [accounts, investments, assetsNet, assetsGross, assetsDebts]);

  const positiveParts = segments.map((s) => Math.max(0, s.amount));
  const barTotal = positiveParts.reduce((a, b) => a + b, 0) || 1;

  const variantClass = total === 0 ? 'text-light' : total > 0 ? 'text-accent' : 'text-danger';
  const deltaToneClass =
    compare?.deltaTone === 'positive'
      ? 'text-accent'
      : compare?.deltaTone === 'negative'
        ? 'text-danger'
        : 'text-gray-500';

  return (
    <Card
      className={`flex flex-col h-full min-h-[200px] group !overflow-visible hover:bg-secondary/40 transition-all duration-300 sm:col-span-2 lg:col-span-3 ${className}`}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-gray-400 text-[10px] font-bold uppercase tracking-widest opacity-80">
            Patrimônio total
          </h3>
          <div className="group/tooltip relative shrink-0">
            <InformationCircleIcon className="h-3.5 w-3.5 text-gray-500 hover:text-gray-300 cursor-help" />
            <div className="absolute left-0 bottom-full mb-2 hidden w-56 p-3 bg-slate-950/98 backdrop-blur-xl text-[10px] leading-relaxed text-slate-300 rounded-xl shadow-2xl border border-white/10 group-hover/tooltip:block z-[9999] pointer-events-none">
              Soma do que você possui hoje: contas + investimentos + bens (valor de mercado menos
              financiamento). «Líquido» nos bens é valor líquido patrimonial, não dinheiro disponível. Não é o
              fluxo do mês.
            </div>
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-white/5 to-white/10 border border-white/5 text-accent shrink-0">
          <ArrowsUpDownIcon className="w-4 h-4" />
        </div>
      </div>

      {compare && primaryPeriodLabel ? (
        <div className="mt-3">
          <PeriodCompareColumns
            primaryLabel={primaryPeriodLabel}
            compareLabel={compare.periodLabel}
            minHeight="min-h-[96px]"
            primary={
              <p className={`text-2xl font-bold tracking-tight tabular-nums ${variantClass}`}>
                {formatCurrency(total)}
              </p>
            }
            compare={
              <p className="text-2xl font-bold tracking-tight tabular-nums text-slate-200">
                {formatCurrency(compare.breakdown.total)}
              </p>
            }
            footer={
              <p className={`text-[10px] font-semibold text-center ${deltaToneClass}`}>
                {compare.deltaLabel}
              </p>
            }
          />
          <p className="text-[10px] text-slate-500 mt-2 text-center">
            Posição no fim de cada período (contas + investimentos + bens)
          </p>
        </div>
      ) : (
        <>
          <p className={`text-2xl sm:text-3xl font-bold tracking-tight mt-3 ${variantClass}`}>
            {formatCurrency(total)}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            Patrimônio consolidado (ativos − financiamentos dos bens)
          </p>
        </>
      )}

      {barTotal > 0 && total > 0 ? (
        <div
          className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800/80 border border-white/5"
          role="img"
          aria-label="Composição do patrimônio"
        >
          {segments.map((seg) => {
            const w = Math.max(0, seg.amount) / barTotal;
            if (w < 0.005) return null;
            return (
              <div
                key={seg.id}
                className={`${seg.barColor} h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full`}
                style={{ width: `${w * 100}%` }}
                title={`${seg.label}: ${formatCurrency(seg.amount)}`}
              />
            );
          })}
        </div>
      ) : null}

      <ul className="mt-4 space-y-2.5 flex-1">
        {segments.map((seg) => {
          const pct = total !== 0 ? (seg.amount / Math.abs(total)) * 100 : 0;
          return (
            <li
              key={seg.id}
              className="grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5 items-baseline text-sm border-b border-white/5 pb-2 last:border-0 last:pb-0"
            >
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${seg.barColor}`} aria-hidden />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`font-semibold ${seg.color}`}>{seg.label}</span>
                  <span
                    className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${seg.liquidityClass}`}
                  >
                    {seg.liquidityTag}
                  </span>
                </div>
                <span className="block text-[10px] text-slate-400 leading-snug mt-0.5">{seg.hint}</span>
                {seg.detail ? (
                  <span className="block text-[10px] text-slate-300/80 mt-0.5">{seg.detail}</span>
                ) : null}
              </div>
              <div className="text-right shrink-0">
                <span className="font-bold text-slate-100 tabular-nums">{formatCurrency(seg.amount)}</span>
                {total !== 0 ? (
                  <span className="block text-[10px] text-slate-500 tabular-nums">{pct.toFixed(0)}%</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-slate-500 mt-3 pt-2 border-t border-white/5 leading-relaxed">
        Contas + Investimentos + Bens patrimoniais = {formatCurrency(total)}
      </p>
    </Card>
  );
};

export default NetWorthSummaryCard;
