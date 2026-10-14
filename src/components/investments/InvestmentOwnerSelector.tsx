import React, { useEffect, useMemo } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { useFamilyOwnerContext } from '../../hooks/useFamilyOwnerContext';
import type { InvestmentOwnerOption } from '../../domain/investments/ownerScope';

/**
 * Seletor de proprietário (V2-B1B, D3). Montado SÓ com a flag ligada: os vínculos familiares são lidos aqui, e a tela
 * de sempre não faz consulta nenhuma a mais. Mesma origem de proprietários de Transações e Dashboard.
 */
export interface InvestmentOwnerSelectorProps {
  value: string;
  onChange: (ownerUserId: string) => void;
  onOptionsChange: (options: InvestmentOwnerOption[]) => void;
}

const InvestmentOwnerSelector: React.FC<InvestmentOwnerSelectorProps> = ({ value, onChange, onOptionsChange }) => {
  const { user, accounts, transactions } = useAppStore();
  const context = useFamilyOwnerContext(user?.id, user?.email, accounts, transactions);
  const options = useMemo<InvestmentOwnerOption[]>(
    () => context.owners.map((o) => ({ userId: o.userId, label: o.label, isSelf: o.isSelf })),
    [context.owners]
  );
  const signature = options.map((o) => `${o.userId}:${o.label}`).join('|');

  useEffect(() => {
    onOptionsChange(options);
  }, [signature]);

  return <OwnerSelectorView options={options} value={value} onChange={onChange} />;
};

/** Apresentação pura: com um único proprietário não há o que escolher e nada é exibido. */
export const OwnerSelectorView: React.FC<{ options: InvestmentOwnerOption[]; value: string; onChange: (id: string) => void }> = ({ options, value, onChange }) => {
  if (options.length < 2) return null;
  return (
    <div data-owner-selector="" className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <label htmlFor="investment-owner" className="text-sm text-gray-400">Investimentos de</label>
      <select
        id="investment-owner"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none sm:w-auto"
      >
        {options.map((o) => (
          <option key={o.userId} value={o.userId}>{o.isSelf ? 'Você' : o.label}</option>
        ))}
      </select>
    </div>
  );
};

export default InvestmentOwnerSelector;
