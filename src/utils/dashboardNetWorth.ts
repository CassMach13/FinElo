import type { Account, Asset, Transaction } from '../types';

function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function computeAccountBalanceAsOf(
  account: Account,
  transactions: Transaction[],
  asOfDate: Date
): number {
  const cutoffStr = toLocalDateStr(asOfDate);
  const cutoffTime = asOfDate.getTime();
  const isCreditCard = account.Tipo_Conta === 'Cartão de Crédito';
  const initialBalanceDate = new Date(account.Data_Saldo_Inicial).getTime();

  const relevantTransactionsSum = transactions
    .filter((t) => {
      if (t.ID_Conta !== account.id) return false;
      const transactionPurchaseDate = new Date(t.Data).getTime();

      if (isCreditCard) {
        return (
          transactionPurchaseDate > initialBalanceDate && transactionPurchaseDate <= cutoffTime
        );
      }

      const paymentDateStr = t.Data_Pagamento
        ? toLocalDateStr(new Date(t.Data_Pagamento))
        : toLocalDateStr(new Date(t.Data));
      return transactionPurchaseDate > initialBalanceDate && paymentDateStr <= cutoffStr;
    })
    .reduce((sum, t) => sum + t.Valor, 0);

  return Math.round((account.Saldo_Inicial + relevantTransactionsSum) * 100) / 100;
}

export function computeAccountsTotalAsOf(
  accounts: Account[],
  transactions: Transaction[],
  asOfDate: Date
): number {
  return accounts.reduce(
    (sum, account) => sum + computeAccountBalanceAsOf(account, transactions, asOfDate),
    0
  );
}

export interface NetWorthSnapshot {
  total: number;
  accounts: number;
  investments: number;
  assetsNet: number;
  assetsGross: number;
  assetsDebts: number;
}

export function computeAssetsTotals(assets: Asset[]): {
  gross: number;
  debts: number;
  net: number;
} {
  const gross = assets.reduce((sum, a) => sum + a.value, 0);
  const debts = assets.reduce((sum, a) => sum + (a.remaining_balance || 0), 0);
  return { gross, debts, net: gross - debts };
}

export function computeNetWorthSnapshot(
  accounts: Account[],
  transactions: Transaction[],
  assets: Asset[],
  manualInvestmentsTotal: number,
  asOfDate: Date
): NetWorthSnapshot {
  const accountsTotal = computeAccountsTotalAsOf(accounts, transactions, asOfDate);
  const { gross, debts, net } = computeAssetsTotals(assets);
  const total = accountsTotal + manualInvestmentsTotal + net;

  return {
    total,
    accounts: accountsTotal,
    investments: manualInvestmentsTotal,
    assetsNet: net,
    assetsGross: gross,
    assetsDebts: debts,
  };
}
