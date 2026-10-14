import React from 'react';
import { formatCurrency } from '../../utils/formatters';
import type { OwnerInvestmentSummary } from '../../domain/investments/ownerInvestmentTotals';
import type { OwnerInvestmentsStatus } from '../../services/ownerInvestmentsLoader';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const formatReferenceMonth = (monthKey: string): string => {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]}/${y}`;
};

/**
 * Nota do patrimônio no escopo por proprietário: de quem é o total e de quando são as posições de investimento.
 * Com meses diferentes entre proprietários, diz isso explicitamente (não é uma única fotografia do mesmo mês).
 */
const OwnerScopeNetWorthNote: React.FC<{
  scopeLabel: string;
  status: OwnerInvestmentsStatus;
  summary: OwnerInvestmentSummary | null;
  ownerLabel: (ownerUserId: string) => string;
}> = ({ scopeLabel, status, summary, ownerLabel }) => {
  if (status === 'error') {
    return (
      <p data-networth-note="error" role="alert" className="text-xs text-amber-200">
        Patrimônio de {scopeLabel}: não foi possível carregar os investimentos; o total abaixo não os inclui.
      </p>
    );
  }
  if (status !== 'ready' || !summary) return null;
  const withPositions = summary.byOwner.filter((o) => o.monthKey && o.positions > 0);
  return (
    <div data-networth-note={summary.mixedMonths ? 'mixed' : 'single'} className="space-y-1 text-xs text-gray-400">
      <p>
        Patrimônio de <strong className="text-gray-200">{scopeLabel}</strong>
        {withPositions.length > 0 && !summary.mixedMonths && (
          <> · investimentos com posição de {formatReferenceMonth(summary.monthKeys[0])}</>
        )}
        {withPositions.length === 0 && <> · sem posição de investimentos registrada até o período</>}
      </p>
      {summary.mixedMonths && (
        <p className="text-amber-200/90">
          Investimentos com meses de referência diferentes (é a última posição de cada proprietário, não uma fotografia do
          mesmo mês):{' '}
          {withPositions
            .map((o) => `${ownerLabel(o.ownerUserId)} ${formatReferenceMonth(o.monthKey as string)} — ${formatCurrency(o.totalCents / 100)}`)
            .join('; ')}
          .
        </p>
      )}
    </div>
  );
};

export default OwnerScopeNetWorthNote;
