import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { supabase } from '../../supabaseClient';
import type { FamilyMember } from '../../types';
import { parseFamilyMemberNicknames, type FamilyMemberNicknames } from '../../utils/familyMemberNicknames';
import type { InvestmentOwnerOption } from '../../domain/investments/ownerScope';
import { discoverInvestmentOwners, type OwnerDiscoveryDeps } from '../../services/investmentOwnerDiscovery';

/**
 * Seletor de proprietário (V2-B1B, D3). Montado SÓ com a flag ligada: os vínculos familiares são lidos aqui, e a tela
 * de sempre não faz consulta nenhuma a mais. Os proprietários vêm do contrato familiar + RLS de `investments`
 * (`discoverInvestmentOwners`), não de contas ou transações.
 */
export interface InvestmentOwnerSelectorProps {
  value: string;
  onChange: (ownerUserId: string) => void;
  onOptionsChange: (options: InvestmentOwnerOption[]) => void;
}

export const supabaseOwnerDiscoveryDeps: OwnerDiscoveryDeps = {
  async listFamilyLinks() {
    const { data, error } = await supabase.from('family_members').select('*');
    if (error) throw error;
    return (data ?? []) as FamilyMember[];
  },
  async findVisibleInvestmentOwner(excluding) {
    const { data, error } = await supabase
      .from('investments')
      .select('user_id')
      .not('user_id', 'in', `(${excluding.join(',')})`)
      .limit(1);
    if (error) throw error;
    return (data?.[0]?.user_id as string | undefined) ?? null;
  },
};

/**
 * Carrega as opções da sessão atual. Resposta de uma sessão anterior é descartada; falha mantém só a própria sessão
 * (nunca amplia o acesso — e a RLS decide de qualquer forma).
 */
export function createOwnerOptionsLoader(deps: OwnerDiscoveryDeps, onOptions: (sessionUserId: string, options: InvestmentOwnerOption[]) => void) {
  let latest = 0;
  return async (session: { userId: string; email: string }, nicknames?: FamilyMemberNicknames) => {
    const id = ++latest;
    let options: InvestmentOwnerOption[];
    try {
      options = await discoverInvestmentOwners(deps, session, nicknames);
    } catch (error) {
      console.warn('[Investimentos] Falha ao carregar proprietários familiares:', error);
      options = [{ userId: session.userId, label: 'Você', isSelf: true }];
    }
    if (id === latest) onOptions(session.userId, options);
  };
}

const InvestmentOwnerSelector: React.FC<InvestmentOwnerSelectorProps> = ({ value, onChange, onOptionsChange }) => {
  const { user } = useAppStore();
  const [state, setState] = useState<{ sessionUserId: string; options: InvestmentOwnerOption[] } | null>(null);
  const [load] = useState(() => createOwnerOptionsLoader(supabaseOwnerDiscoveryDeps, (sessionUserId, options) => setState({ sessionUserId, options })));

  // Mesmos apelidos de Transações/Configurações (user_metadata); mudar um apelido atualiza o rótulo.
  const nicknamesKey = JSON.stringify(parseFamilyMemberNicknames(user?.user_metadata));
  useEffect(() => {
    if (!user?.id) return;
    void load({ userId: user.id, email: user.email ?? '' }, JSON.parse(nicknamesKey) as FamilyMemberNicknames);
  }, [user?.id, user?.email, nicknamesKey]);

  const options = state && state.sessionUserId === user?.id ? state.options : [];
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
