import type { Account, Asset, Budget, BudgetMonth, EconomicEvent, Transaction } from '../../types';

/**
 * Escopo por proprietário do Dashboard (flag `dashboard_owner_scope_enabled`). Funções puras.
 *
 * - "Você" (padrão): só os dados da sessão.
 * - Um familiar autorizado: só os dados daquele proprietário.
 * - "Família (consolidado)": tudo o que a RLS libera — escolha explícita, nunca automática.
 *
 * Os dados são filtrados ANTES dos cálculos. Cada linha tem um único proprietário, então nenhuma é somada duas vezes.
 * A RLS continua sendo quem autoriza: o escopo só restringe o que a sessão já pode ler.
 */

export const FAMILY_SCOPE = '__family__';
export const SELF_SCOPE = '__self__';

export interface DashboardOwnerOption {
  userId: string;
  label: string;
  isSelf: boolean;
}

export type DashboardScopeKind = 'self' | 'owner' | 'family';

export interface DashboardScope {
  kind: DashboardScopeKind;
  /** Proprietários incluídos; `null` = todos os que a RLS libera (consolidado). */
  ownerIds: string[] | null;
  /** Muda quando a sessão ou o proprietário mudam: respostas de outro escopo são descartadas. */
  key: string;
  label: string;
}

export function resolveDashboardScope(
  sessionUserId: string | null | undefined,
  selection: string | null | undefined,
  options: readonly DashboardOwnerOption[]
): DashboardScope {
  const session = sessionUserId ?? '';
  const others = options.filter((o) => !o.isSelf && o.userId !== session);
  if (session && selection === FAMILY_SCOPE && others.length > 0) {
    return { kind: 'family', ownerIds: null, key: `${session}|family`, label: 'Família (consolidado)' };
  }
  const chosen = others.find((o) => o.userId === selection);
  if (session && chosen) {
    return { kind: 'owner', ownerIds: [chosen.userId], key: `${session}|owner|${chosen.userId}`, label: chosen.label };
  }
  return { kind: 'self', ownerIds: session ? [session] : [], key: `${session}|self`, label: 'Você' };
}

export const isInScope = (scope: DashboardScope, ownerId: string | null | undefined): boolean =>
  scope.ownerIds === null || (!!ownerId && scope.ownerIds.includes(ownerId));

export interface DashboardSourceData {
  transactions: Transaction[];
  accounts: Account[];
  assets: Asset[];
  budgets: Budget[];
  budgetMonths: BudgetMonth[];
  economicEvents: EconomicEvent[];
}

/**
 * Filtra cada fonte pelo proprietário. Transação: mesmo critério de Transações (`user_id`, senão o dono da conta);
 * sem dono identificável só entra na própria visão. Orçamento sem `user_id` é da sessão (mesma regra do cálculo de
 * orçamento). O consolidado devolve as MESMAS referências (nada muda em relação ao comportamento anterior).
 */
export function scopeDashboardData(
  scope: DashboardScope,
  data: DashboardSourceData,
  options: { sessionUserId: string; getTransactionOwnerId: (tx: Transaction) => string | undefined }
): DashboardSourceData {
  if (scope.ownerIds === null) return data;
  const owners = new Set(scope.ownerIds);
  const self = scope.kind === 'self';
  const has = (id: string | null | undefined) => !!id && owners.has(id);
  return {
    transactions: data.transactions.filter((tx) => {
      const owner = options.getTransactionOwnerId(tx);
      return owner ? owners.has(owner) : self;
    }),
    accounts: data.accounts.filter((a) => has(a.user_id)),
    assets: data.assets.filter((a) => has(a.user_id)),
    budgets: data.budgets.filter((b) => has(b.user_id ?? options.sessionUserId)),
    budgetMonths: data.budgetMonths.filter((m) => has(m.user_id)),
    economicEvents: data.economicEvents.filter((e) => has(e.user_id)),
  };
}

/** Proprietários cujos investimentos entram no escopo (no consolidado: todos os conhecidos, sem repetir). */
export function investmentOwnersFor(scope: DashboardScope, knownOwnerIds: readonly string[]): string[] {
  if (scope.ownerIds !== null) return [...scope.ownerIds];
  return [...new Set(knownOwnerIds.filter(Boolean))].sort();
}
