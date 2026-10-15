import React from 'react';
import type { OwnerDiscoveryResult } from '../../services/investmentOwnerDiscovery';

export function familyAvailabilityMessage(context: Pick<OwnerDiscoveryResult, 'status' | 'linkedFamilyCount' | 'unavailableFamilyCount'>): string {
  if (context.status === 'loading') return 'Verificando vínculos familiares…';
  if (context.status === 'error') return 'Não foi possível verificar os familiares vinculados.';
  const count = context.linkedFamilyCount;
  if (count === 0) return 'Nenhum familiar vinculado';
  const linked = count === 1 ? '1 familiar vinculado' : `${count} familiares vinculados`;
  if (context.unavailableFamilyCount === count) return `${linked} — sem dados financeiros disponíveis`;
  if (context.unavailableFamilyCount > 0) return `${linked} — ${context.unavailableFamilyCount} sem dados financeiros disponíveis`;
  return linked;
}

/** Sem escolha segura, o escopo continua visível como texto; não há opção vazia nem consolidado automático. */
const OwnerScopeControl: React.FC<{
  id: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  context: OwnerDiscoveryResult;
}> = ({ id, options, value, onChange, context }) => {
  const selected = options.find((o) => o.value === value) ?? options[0];
  const statusId = `${id}-family-status`;
  return (
    <div className="min-w-0 max-w-full space-y-1 print:hidden">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {options.length > 1 ? (
          <>
            <label htmlFor={id} className="text-sm text-gray-300">Visão:</label>
            <select
              id={id}
              value={selected?.value ?? ''}
              onChange={(e) => onChange(e.target.value)}
              aria-describedby={statusId}
              className="min-h-11 w-full min-w-0 max-w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none sm:w-auto sm:max-w-sm"
            >
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </>
        ) : (
          <p className="min-w-0 break-words text-sm text-gray-300">Visão: <strong className="font-medium text-white">Você</strong></p>
        )}
      </div>
      <p id={statusId} role="status" className="break-words text-xs text-gray-300">{familyAvailabilityMessage(context)}</p>
      {context.status === 'ready' && context.unresolvedFamilyCount > 0 && (
        <p className="break-words text-xs text-gray-300">Visões familiares só ficam disponíveis quando é possível identificar o titular com segurança.</p>
      )}
    </div>
  );
};

export default OwnerScopeControl;
