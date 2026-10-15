import React, { useEffect } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { useOwnerDiscovery } from '../../hooks/useOwnerDiscovery';
import { supabase } from '../../supabaseClient';
import { selfOwnerDiscovery, type OwnerDiscoveryDeps, type OwnerDiscoveryResult } from '../../services/investmentOwnerDiscovery';
import { supabaseOwnerDiscoveryDeps } from '../investments/InvestmentOwnerSelector';
import OwnerScopeControl from '../family/OwnerScopeControl';
import { FAMILY_SCOPE, SELF_SCOPE, type DashboardOwnerOption } from '../../domain/dashboard/dashboardOwnerScope';

export const DASHBOARD_OWNER_PROBE_TABLES = ['investments', 'contas', 'assets'] as const;

export function createDashboardOwnerDiscoveryDeps(
  base: Pick<OwnerDiscoveryDeps, 'listFamilyLinks'>,
  probe: (table: (typeof DASHBOARD_OWNER_PROBE_TABLES)[number], excluding: string[]) => Promise<string | null>
): OwnerDiscoveryDeps {
  return {
    listFamilyLinks: base.listFamilyLinks,
    async findVisibleInvestmentOwner(excluding) {
      for (const table of DASHBOARD_OWNER_PROBE_TABLES) {
        const found = await probe(table, excluding);
        if (found) return found;
      }
      return null;
    },
  };
}

const dashboardOwnerDiscoveryDeps = createDashboardOwnerDiscoveryDeps(supabaseOwnerDiscoveryDeps, async (table, excluding) => {
  const { data, error } = await supabase.from(table).select('user_id').not('user_id', 'in', `(${excluding.join(',')})`).limit(1);
  if (error) throw error;
  return (data?.[0]?.user_id as string | undefined) ?? null;
});

export interface DashboardOwnerSelectorProps {
  value: string;
  onChange: (selection: string) => void;
  onOptionsChange: (options: DashboardOwnerOption[]) => void;
  knownOwners: ReadonlyArray<{ userId: string; label: string }>;
}

/** Vínculos são contados sem dados; titulares conhecidos também precisam passar pela resolução segura do vínculo. */
const DashboardOwnerSelector: React.FC<DashboardOwnerSelectorProps> = ({ value, onChange, onOptionsChange, knownOwners }) => {
  const { user } = useAppStore();
  const context = useOwnerDiscovery(user, dashboardOwnerDiscoveryDeps, knownOwners);
  useEffect(() => { onOptionsChange(context.options); }, [context.options, onOptionsChange]);
  return <DashboardOwnerSelectorView options={context.options} value={value} onChange={onChange} context={context} />;
};

export const DashboardOwnerSelectorView: React.FC<{
  options: DashboardOwnerOption[];
  value: string;
  onChange: (selection: string) => void;
  context?: OwnerDiscoveryResult;
}> = ({ options, value, onChange, context = selfOwnerDiscovery('', 'ready') }) => (
  <div data-dashboard-owner-selector="">
    <OwnerScopeControl
      id="dashboard-owner"
      options={[
        ...options.map((o) => ({ value: o.isSelf ? SELF_SCOPE : o.userId, label: o.isSelf ? 'Você' : o.label })),
        ...(options.length > 1 ? [{ value: FAMILY_SCOPE, label: 'Família (consolidado)' }] : []),
      ]}
      value={value}
      onChange={onChange}
      context={context}
    />
  </div>
);

export default DashboardOwnerSelector;
