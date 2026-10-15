import React, { useEffect } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { useOwnerDiscovery } from '../../hooks/useOwnerDiscovery';
import { supabase } from '../../supabaseClient';
import type { FamilyMember } from '../../types';
import type { InvestmentOwnerOption } from '../../domain/investments/ownerScope';
import { selfOwnerDiscovery, type OwnerDiscoveryDeps, type OwnerDiscoveryResult } from '../../services/investmentOwnerDiscovery';
import OwnerScopeControl from '../family/OwnerScopeControl';

export { createOwnerOptionsLoader } from '../../services/investmentOwnerDiscovery';

export interface InvestmentOwnerSelectorProps {
  value: string;
  onChange: (ownerUserId: string) => void;
  onOptionsChange: (options: InvestmentOwnerOption[]) => void;
}

export const supabaseOwnerDiscoveryDeps: OwnerDiscoveryDeps = {
  allowEmptyLinkedOwners: true,
  async listFamilyLinks() {
    const { data, error } = await supabase.from('family_members').select('*');
    if (error) throw error;
    return (data ?? []) as FamilyMember[];
  },
  async findVisibleInvestmentOwner(excluding) {
    const { data, error } = await supabase.from('investments').select('user_id').not('user_id', 'in', `(${excluding.join(',')})`).limit(1);
    if (error) throw error;
    return (data?.[0]?.user_id as string | undefined) ?? null;
  },
};

/** Montado só pela flag independente de carteiras; opções usam exclusivamente a RLS de investments. */
const InvestmentOwnerSelector: React.FC<InvestmentOwnerSelectorProps> = ({ value, onChange, onOptionsChange }) => {
  const { user } = useAppStore();
  const context = useOwnerDiscovery(user, supabaseOwnerDiscoveryDeps);
  useEffect(() => { onOptionsChange(context.options); }, [context.options, onOptionsChange]);
  return <OwnerSelectorView options={context.options} value={value} onChange={onChange} context={context} />;
};

export const OwnerSelectorView: React.FC<{
  options: InvestmentOwnerOption[];
  value: string;
  onChange: (id: string) => void;
  context?: OwnerDiscoveryResult;
}> = ({ options, value, onChange, context = selfOwnerDiscovery('', 'ready') }) => (
  <div data-owner-selector="">
    <OwnerScopeControl id="investment-owner" options={options.map((o) => ({ value: o.userId, label: o.isSelf ? 'Você' : o.label }))} value={value} onChange={onChange} context={context} />
  </div>
);

export default InvestmentOwnerSelector;
