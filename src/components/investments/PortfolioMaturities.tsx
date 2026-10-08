import React from 'react';
import { formatCurrency } from '../../utils/formatters';
import { formatMonthLabel } from '../../domain/investments/portfolioOverview';
import { MATURITY_WINDOW_DAYS, formatDateBR, type MaturityAgenda } from '../../domain/investments/portfolioInsights';

interface Props {
  agenda: MaturityAgenda;
  monthKey: string;
}

const STATE_COPY = {
  no_positions: 'Sem posições registradas neste mês.',
  no_dates: 'Os investimentos deste mês não possuem datas de vencimento suficientes para montar uma agenda.',
  none_in_window: 'Nenhum vencimento informado dentro da janela selecionada.',
} as const;

/** Agenda de vencimentos da posição do mês. Saldos são os REGISTRADOS, não valores futuros de resgate. */
const PortfolioMaturities: React.FC<Props> = ({ agenda, monthKey }) => {
  const month = formatMonthLabel(monthKey);
  const { coverage } = agenda;
  const title = agenda.temporal === 'current' ? `Vencimentos nos próximos ${MATURITY_WINDOW_DAYS} dias` : `Vencimentos da posição de ${month}`;
  return (
    <section aria-label="Agenda de vencimentos" data-maturities={agenda.temporal} className="min-w-0 rounded-2xl border border-slate-700/50 bg-secondary p-4 shadow-xl sm:p-6">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {agenda.temporal === 'current' ? (
        <p className="mb-4 text-xs text-gray-500">De hoje ({formatDateBR(agenda.referenceDate)}) até {formatDateBR(agenda.windowEnd)}, inclusive.</p>
      ) : (
        <p data-maturities-note="" className="mb-4 text-xs text-gray-500">
          Janela de {MATURITY_WINDOW_DAYS} dias a partir de {formatDateBR(agenda.referenceDate)}. Essas datas pertencem ao registro daquele mês
          {agenda.temporal === 'future' ? ' e não representam previsão de investimentos futuros.' : ' e não confirmam posições atuais.'}
        </p>
      )}

      {agenda.state === 'has_items' ? (
        <>
          <p data-maturities-total="" className="mb-3 text-sm text-gray-200">
            {agenda.itemCount} {agenda.itemCount === 1 ? 'posição com vencimento na janela' : 'posições com vencimento na janela'} ·{' '}
            <span className="tabular-nums">{formatCurrency(agenda.totalBalance)}</span> em saldos registrados
          </p>
          <ul className="divide-y divide-slate-700/40">
            {agenda.items.map((item) => (
              <li key={item.id} data-maturity-item="" className="flex min-w-0 items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-100" title={item.name}>{item.name}</p>
                  <p className="truncate text-xs text-gray-500">{item.institution}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm tabular-nums text-gray-200">{formatCurrency(item.balance)}</p>
                  <p className="text-xs text-gray-400">
                    {formatDateBR(item.maturityDate)} · {item.daysUntil === 0 ? 'no dia de referência' : `${item.daysUntil} ${item.daysUntil === 1 ? 'dia' : 'dias'}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-gray-500">Valores correspondem aos saldos registrados, não a valores futuros de resgate.</p>
        </>
      ) : (
        <p data-maturities-state={agenda.state} className="text-sm text-gray-400">{STATE_COPY[agenda.state]}</p>
      )}

      {coverage.total > 0 && (
        <p data-maturities-coverage="" className="mt-3 text-[11px] text-gray-500">
          Datas de vencimento disponíveis em {coverage.valid} {coverage.total === 1 ? 'de 1 posição' : `das ${coverage.total} posições`}
          {coverage.missing > 0 ? ` · ${coverage.missing} sem data` : ''}
          {coverage.invalid > 0 ? ` · ${coverage.invalid} com data inválida` : ''}.
        </p>
      )}
    </section>
  );
};

export default PortfolioMaturities;
