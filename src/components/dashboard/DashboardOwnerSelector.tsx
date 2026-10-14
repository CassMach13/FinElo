import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { parseFamilyMemberNicknames, type FamilyMemberNicknames } from '../../utils/familyMemberNicknames';
import { createOwnerOptionsLoader, supabaseOwnerDiscoveryDeps } from '../investments/InvestmentOwnerSelector';
import { FAMILY_SCOPE, SELF_SCOPE, type DashboardOwnerOption } from '../../domain/dashboard/dashboardOwnerScope';

/**
 * Seletor de proprietário do Dashboard (flag `dashboard_owner_scope_enabled`). Montado SÓ com a flag ligada.
 * Proprietários = descoberta da V2-B1B (vínculo aceito + RLS de investimentos) ∪ donos já conhecidos por contas e
 * transações carregadas. Com um único proprietário acessível não exibe nada.
 */
export function mergeOwnerOptions(
  sessionUserId: string,
  discovered: readonly DashboardOwnerOption[],
  known: ReadonlyArray<{ userId: string; label: string }>
): DashboardOwnerOption[] {
  const byId = new Map<string, DashboardOwnerOption>();
  byId.set(sessionUserId, { userId: sessionUserId, label: 'Você', isSelf: true });
  for (const o of discovered) if (o.userId && o.userId !== sessionUserId) byId.set(o.userId, { ...o, isSelf: false });
  for (const o of known) {
    if (!o.userId || o.userId === sessionUserId || byId.has(o.userId)) continue;
    byId.set(o.userId, { userId: o.userId, label: o.label, isSelf: false });
  }
  const [self, ...others] = [...byId.values()];
  return [self, ...others.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))];
}

export interface DashboardOwnerSelectorProps {
  value: string;
  onChange: (selection: string) => void;
  onOptionsChange: (options: DashboardOwnerOption[]) => void;
  knownOwners: ReadonlyArray<{ userId: string; label: string }>;
}

const DashboardOwnerSelector: React.FC<DashboardOwnerSelectorProps> = ({ value, onChange, onOptionsChange, knownOwners }) => {
  const { user } = useAppStore();
  const [discovered, setDiscovered] = useState<{ sessionUserId: string; options: DashboardOwnerOption[] } | null>(null);
  const [load] = useState(() =>
    createOwnerOptionsLoader(supabaseOwnerDiscoveryDeps, (sessionUserId, options) => setDiscovered({ sessionUserId, options }))
  );
  const nicknamesKey = JSON.stringify(parseFamilyMemberNicknames(user?.user_metadata));

  useEffect(() => {
    if (!user?.id) return;
    void load({ userId: user.id, email: user.email ?? '' }, JSON.parse(nicknamesKey) as FamilyMemberNicknames);
  }, [user?.id, user?.email, nicknamesKey]);

  const options = useMemo(() => {
    if (!user?.id) return [];
    const found = discovered && discovered.sessionUserId === user.id ? discovered.options : [];
    return mergeOwnerOptions(user.id, found, knownOwners);
  }, [user?.id, discovered, knownOwners]);
  const signature = options.map((o) => `${o.userId}:${o.label}`).join('|');
  useEffect(() => {
    onOptionsChange(options);
  }, [signature]);

  return <DashboardOwnerSelectorView options={options} value={value} onChange={onChange} />;
};

/** Apresentação pura: "Você" primeiro, cada familiar, e o consolidado como escolha explícita no fim. */
export const DashboardOwnerSelectorView: React.FC<{
  options: DashboardOwnerOption[];
  value: string;
  onChange: (selection: string) => void;
}> = ({ options, value, onChange }) => {
  if (options.length < 2) return null;
  return (
    <div data-dashboard-owner-selector="" className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 print:hidden">
      <label htmlFor="dashboard-owner" className="text-xs font-bold uppercase tracking-wider text-gray-500">Visão</label>
      <select
        id="dashboard-owner"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none sm:w-auto"
      >
        {options.map((o) => (
          <option key={o.userId} value={o.isSelf ? SELF_SCOPE : o.userId}>{o.isSelf ? 'Você' : o.label}</option>
        ))}
        <option value={FAMILY_SCOPE}>Família (consolidado)</option>
      </select>
    </div>
  );
};

export default DashboardOwnerSelector;
