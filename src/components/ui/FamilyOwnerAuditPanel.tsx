import React from 'react';
import FamilyOwnerBadge from './FamilyOwnerBadge';
import { formatCurrency } from '../../utils/formatters';
import type { FamilyOwnerPeriodTotal } from '../../utils/familyOwnerSummary';
import type { FamilyOwnerProfile } from '../../utils/familyOwnerContext';

interface FamilyOwnerAuditPanelProps {
  owners: FamilyOwnerProfile[];
  periodTotals: FamilyOwnerPeriodTotal[];
  periodLabel: string;
  activeOwnerUserId?: string;
  showOwnerColumn: boolean;
  groupByOwner: boolean;
  onOwnerFilter: (ownerUserId: string) => void;
  onToggleOwnerColumn: (visible: boolean) => void;
  onToggleGroupByOwner: (enabled: boolean) => void;
}

const FamilyOwnerAuditPanel: React.FC<FamilyOwnerAuditPanelProps> = ({
  owners,
  periodTotals,
  periodLabel,
  activeOwnerUserId = '',
  showOwnerColumn,
  groupByOwner,
  onOwnerFilter,
  onToggleOwnerColumn,
  onToggleGroupByOwner,
}) => {
  const hasActivity = periodTotals.some(
    (row) => row.expenseTotal > 0 || row.incomeTotal > 0 || row.transactionCount > 0
  );

  return (
    <div className="rounded-xl border border-white/10 bg-slate-800/70 backdrop-blur-sm p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 shrink-0">
            Plano família
          </span>
          {owners.map((owner) => (
            <FamilyOwnerBadge key={owner.userId} profile={owner} compact />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-slate-600 bg-slate-700 text-accent focus:ring-accent/40"
              checked={groupByOwner}
              onChange={(e) => onToggleGroupByOwner(e.target.checked)}
            />
            Agrupar por pessoa
          </label>
          <label className="hidden lg:inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-slate-600 bg-slate-700 text-accent focus:ring-accent/40"
              checked={showOwnerColumn}
              onChange={(e) => onToggleOwnerColumn(e.target.checked)}
            />
            Coluna responsável
          </label>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
          Gastos no período · {periodLabel}
        </p>
        {hasActivity ? (
          <div className="flex flex-wrap gap-2">
            {periodTotals.map((row) => {
              const isActive = activeOwnerUserId === row.userId;
              const hasExpense = row.expenseTotal > 0;
              return (
                <button
                  key={row.userId}
                  type="button"
                  onClick={() => onOwnerFilter(isActive ? '' : row.userId)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                    isActive
                      ? 'border-accent/60 bg-accent/15'
                      : 'border-white/10 bg-slate-900/40 hover:border-white/20 hover:bg-slate-900/60'
                  }`}
                  title={
                    row.incomeTotal > 0
                      ? `${row.transactionCount} lançamentos · entradas ${formatCurrency(row.incomeTotal)}`
                      : `${row.transactionCount} lançamentos`
                  }
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${row.profile.dotClass}`} aria-hidden />
                  <span className="text-xs font-bold text-white tabular-nums">
                    {hasExpense ? formatCurrency(row.expenseTotal) : 'R$ 0,00'}
                  </span>
                  <span className="text-xs text-slate-300">({row.label})</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Nenhum lançamento no período com os filtros atuais.</p>
        )}
      </div>
    </div>
  );
};

export default FamilyOwnerAuditPanel;
