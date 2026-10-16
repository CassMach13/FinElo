import type { Account, Asset, Transaction } from '../../types';
import type { AccountCardEconomics } from '../../services/accountCardEconomics';
import { computeAccountBalanceAsOf } from '../../utils/dashboardNetWorth';
import { toDateOnlyIso } from '../../utils/dateOnly';

export interface CurrentNetWorthPosition {
  asOf: string;
  completeness: 'complete' | 'partial';
  bankBalanceCents: number | null;
  restrictedBenefitsCents: number | null;
  investmentsCents: number | null;
  assetsGrossCents: number | null;
  assetFinancingCents: number | null;
  assetsNetCents: number | null;
  cardObligationsCents: number | null;
  overdueCardObligationsCents: number | null;
  upcomingCardObligationsCents: number | null;
  provenCardCreditCents: number | null;
  availableAfterOverdueCents: number | null;
  netWorthCents: number | null;
  reconciliationPending: boolean;
  archivedAccountsWithPosition: number;
  issues: string[];
  cards: AccountCardEconomics[];
  origin: { basis: 'current_registered_position'; cardEngine: 'twoLedgerProjection'; historicalComparison: 'unavailable' };
}
const cents = (n: number) => Math.round(n * 100);
const BANK_TYPES = new Set<Account['Tipo_Conta']>(['Conta Corrente', 'Poupança', 'Dinheiro em Espécie']);

/** Current position only. Scope comes from account ownership; all authorized account movements stay in. */
export function computeCurrentNetWorth(input: {
  asOf: string; accounts: Account[]; transactions: Transaction[]; assets: Asset[];
  investmentsCents: number | null; cards: AccountCardEconomics[];
}): CurrentNetWorthPosition {
  const { asOf, transactions, assets, cards } = input;
  const date = new Date(asOf + 'T12:00:00');
  const issues: string[] = [];
  const accounts = [...new Map(input.accounts.map((a) => [a.id, a])).values()];
  let banks = 0, benefits = 0, archived = 0;
  let bankReady = true, benefitsReady = true;
  for (const a of accounts) {
    if (a.Tipo_Conta === 'Cartão de Crédito') {
      const archivedPosition = cards.find((c) => c.accountId === a.id)?.amounts;
      if (a.is_archived && (archivedPosition?.totalRecognizedCents || archivedPosition?.provenCreditCents)) archived++;
      continue;
    }
    const relevant = transactions.filter((t) => t.ID_Conta === a.id);
    const valid = Number.isFinite(a.Saldo_Inicial) && !!toDateOnlyIso(a.Data_Saldo_Inicial)
      && toDateOnlyIso(a.Data_Saldo_Inicial) <= asOf
      && relevant.every((t) => Number.isFinite(t.Valor) && toDateOnlyIso(t.Data)
        && (!t.Data_Pagamento || toDateOnlyIso(t.Data_Pagamento)));
    if (!BANK_TYPES.has(a.Tipo_Conta) && a.Tipo_Conta !== 'Cartão Alimentação') {
      issues.push('unsupported_account_type');
      continue; // No implicit overlap with investment portfolios or invented liquidity.
    }
    if (!valid) {
      issues.push('invalid_account_position');
      if (a.Tipo_Conta === 'Cartão Alimentação') benefitsReady = false; else bankReady = false;
      continue;
    }
    const value = cents(computeAccountBalanceAsOf(a, transactions, date));
    if (a.Tipo_Conta === 'Cartão Alimentação') benefits += value; else banks += value;
    if (a.is_archived && value !== 0) archived++;
  }
  const scopedCards = accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito')
    .map((a) => cards.find((c) => c.accountId === a.id && c.asOf === asOf));
  const cardsReady = scopedCards.every((c) => c?.completeness === 'complete' && c.amounts != null);
  if (!cardsReady) issues.push('incomplete_card_sources');
  const cardSum = (key: keyof NonNullable<AccountCardEconomics['amounts']>) =>
    cardsReady ? scopedCards.reduce((sum, c) => sum + c!.amounts![key], 0) : null;
  const totalDebt = cardSum('totalRecognizedCents'), overdue = cardSum('overdueUnpaidCents');
  const credit = cardSum('provenCreditCents');
  const assetReady = assets.every((a) => Number.isFinite(a.value) && Number.isFinite(a.remaining_balance ?? 0));
  const gross = assetReady ? assets.reduce((sum, a) => sum + cents(a.value), 0) : null;
  const financing = assetReady ? assets.reduce((sum, a) => sum + cents(a.remaining_balance ?? 0), 0) : null;
  const netAssets = assetReady ? gross! - financing! : null;
  if (!assetReady) issues.push('incomplete_asset_sources');
  const investments = input.investmentsCents != null && Number.isSafeInteger(input.investmentsCents) ? input.investmentsCents : null;
  if (investments == null) issues.push('incomplete_investment_sources');
  const complete = !issues.length && bankReady && benefitsReady;
  return {
    asOf, completeness: complete ? 'complete' : 'partial',
    bankBalanceCents: bankReady ? banks : null, restrictedBenefitsCents: benefitsReady ? benefits : null,
    investmentsCents: investments, assetsGrossCents: gross, assetFinancingCents: financing, assetsNetCents: netAssets,
    cardObligationsCents: totalDebt, overdueCardObligationsCents: overdue,
    upcomingCardObligationsCents: cardSum('upcomingCents'), provenCardCreditCents: credit,
    availableAfterOverdueCents: bankReady && overdue != null ? banks - overdue : null,
    netWorthCents: complete ? banks + benefits + investments! + netAssets! + credit! - totalDebt! : null,
    reconciliationPending: scopedCards.some((c) => c?.projection.reconciliationPending),
    archivedAccountsWithPosition: archived, issues: [...new Set(issues)],
    cards: scopedCards.filter((c): c is AccountCardEconomics => !!c),
    origin: { basis: 'current_registered_position', cardEngine: 'twoLedgerProjection', historicalComparison: 'unavailable' },
  };
}

/** Without the owner selector, a current position is personal; family consolidation is always explicit. */
export function selectCurrentNetWorthScope(input: {
  sessionUserId: string;
  scope: import('./dashboardOwnerScope').DashboardScope | null;
  accounts: Account[]; assets: Asset[]; knownOwnerIds: readonly string[];
}) {
  const scope = input.scope ?? {
    key: input.sessionUserId + '|self', label: 'Você', kind: 'self',
    ownerIds: input.sessionUserId ? [input.sessionUserId] : [],
  };
  const ids = scope.ownerIds == null ? null : new Set(scope.ownerIds);
  const accounts = ids ? input.accounts.filter((a) => ids.has(a.user_id)) : input.accounts;
  const assets = ids ? input.assets.filter((a) => ids.has(a.user_id)) : input.assets;
  const ownerIds = ids ? [...ids] : [...new Set([
    input.sessionUserId, ...input.knownOwnerIds, ...accounts.map((a) => a.user_id), ...assets.map((a) => a.user_id),
  ].filter(Boolean))].sort();
  return { key: scope.key, label: scope.label, accounts, assets, ownerIds };
}
