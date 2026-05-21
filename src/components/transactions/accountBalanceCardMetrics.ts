import type { ClassificationRules } from '../../domain/credit-card/classifiers';
import { creditCardRebuildFromImportHistoryService } from '../../services/creditCardRebuildFromImportHistoryService';
import { pickCurrentCompetenceCard } from '../../services/creditCardManualCompetence';
import { Account, ImportLog, Transaction } from '../../types';
import type { AccountCardDisplayData } from './AccountBalanceCard';

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

type CreditCardMotorStatementSnap = {
  currentOpenAmount: number;
  hasData: boolean;
  fetchCompleted: boolean;
};

export type CompetencePaymentConfirmationInput = {
  referenceMonth: string;
  settledAmount: number;
  confirmedAt: string;
};

export interface ComputeAccountCardMetricsOptions {
  transactions: Transaction[];
  accounts: Account[];
  importLogs: ImportLog[];
  rules?: ClassificationRules;
  /** Confirmações «já paguei no banco» — mesmas do modal Histórico de faturas. */
  userPaymentConfirmations?: CompetencePaymentConfirmationInput[];
  cardV2Snapshot?: CreditCardMotorStatementSnap;
  cardV2Enabled: boolean;
  cardEngineEnabled: boolean;
  cardSnapshotPipelineEnabled: boolean;
}

export function computeAccountCardDisplay(
  account: Account,
  options: ComputeAccountCardMetricsOptions
): AccountCardDisplayData {
  const {
    transactions,
    accounts,
    importLogs,
    rules,
    userPaymentConfirmations,
    cardV2Snapshot,
    cardV2Enabled,
    cardEngineEnabled,
    cardSnapshotPipelineEnabled,
  } = options;

  const currentBalance = account.Saldo_Atual_Calculado ?? 0;
  const isCreditCard = account.Tipo_Conta === 'Cartão de Crédito';

  let faturaAtual = 0;
  let totalUsedLimit = 0;
  let diaFecha = 0;
  let diaVence = 0;
  let diasParaFechar = 0;
  let diasParaVencer = 0;

  if (isCreditCard) {
    const toLocalDateStr = (date: Date | string): string => {
      if (!date) return '';
      if (typeof date === 'string') return date.split('T')[0];
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    const now = new Date();
    const todayStr = toLocalDateStr(now);
    const hoje = now.getDate();
    const mesAtual = now.getMonth();
    const anoAtual = now.getFullYear();

    diaFecha = account.dia_fechamento || 0;
    diaVence = account.dia_vencimento || 0;

    const allAccountT = transactions.filter((t) => t.ID_Conta === account.id);
    const manualPayments: Transaction[] = [];
    const statementPaymentsByOrigin = new Map<string, number>();
    const removeAccents = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normalizeOriginKey = (origin?: string) => (origin || 'manual').trim().toLowerCase();
    const byOrigin = new Map<string, { total: number; minDate: string; maxDate: string }>();

    for (const t of allAccountT) {
      const strCat = removeAccents((t.Categoria || '').toLowerCase());
      const strNome = removeAccents((t.Nome_Fantasia || '').toLowerCase());
      const strDesc = removeAccents((t.Descricao_Original || '').toLowerCase());

      const isStatementPayment =
        (strNome.includes('pagamento') && strNome.includes('valido')) ||
        (strDesc.includes('pagamento') && strDesc.includes('valido')) ||
        strNome.includes('pagamento de fatura') ||
        strDesc.includes('pagamento de fatura') ||
        (t.Tipo === 'Renda' && strCat.includes('pagamento'));

      if (isStatementPayment) {
        const paymentOriginKey = normalizeOriginKey(t.Origem);
        const currentPayment = statementPaymentsByOrigin.get(paymentOriginKey) || 0;
        statementPaymentsByOrigin.set(paymentOriginKey, currentPayment + Math.abs(t.Valor));
        continue;
      }
      if (t.Origem === 'manual' && t.Tipo === 'Renda') {
        manualPayments.push(t);
      } else {
        let origemKey = normalizeOriginKey(t.Origem);
        const d = toLocalDateStr(t.Data);
        if (origemKey === 'manual') {
          const [y, m] = d.split('-');
          origemKey = `manual-${y}-${m}`;
        }
        let val = Math.abs(t.Valor);
        if (t.Tipo === 'Renda') val = -val;
        const existing = byOrigin.get(origemKey);
        if (!existing) {
          byOrigin.set(origemKey, { total: val, minDate: d, maxDate: d });
        } else {
          existing.total += val;
          if (d < existing.minDate) existing.minDate = d;
          if (d > existing.maxDate) existing.maxDate = d;
        }
      }
    }

    const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    type InvCycle = {
      label: string;
      startStr: string;
      endStr: string;
      expenses: number;
      payments: number;
      statementPayment: number;
      balance: number;
      isPast: boolean;
      origens: string[];
    };
    const cycleMap = new Map<string, InvCycle>();
    const paymentsByOrigin = new Map<string, Transaction[]>();
    const unmappedPayments: Transaction[] = [];

    for (const t of manualPayments) {
      const orig = normalizeOriginKey(t.Origem);
      if (orig && orig !== 'manual' && byOrigin.has(orig)) {
        if (!paymentsByOrigin.has(orig)) paymentsByOrigin.set(orig, []);
        paymentsByOrigin.get(orig)!.push(t);
      } else {
        unmappedPayments.push(t);
      }
    }

    for (const [origem, info] of byOrigin) {
      const [maxY, maxM] = info.maxDate.split('-').map(Number);
      const targetCloseDay = diaFecha > 0 ? diaFecha : 1;
      const maxDayInMonth = new Date(maxY, maxM, 0).getDate();
      const safeCloseDay = Math.min(targetCloseDay, maxDayInMonth);
      const endDate = new Date(maxY, maxM - 1, safeCloseDay);
      const endStr = toLocalDateStr(endDate);
      const cycleKey = endStr;
      const labelMonth = endDate.getMonth() === 0 ? 11 : endDate.getMonth() - 1;
      const labelYear = endDate.getMonth() === 0 ? endDate.getFullYear() - 1 : endDate.getFullYear();
      const label = `${MONTH_NAMES[labelMonth]}/${String(labelYear).slice(2)}`;
      const exactPayments = paymentsByOrigin.get(origem) || [];
      const exactPaymentSum = exactPayments.reduce((acc, t) => acc + Math.abs(t.Valor), 0);
      const statementPaymentSum = statementPaymentsByOrigin.get(origem) || 0;
      const existing = cycleMap.get(cycleKey);
      if (existing) {
        existing.expenses = Math.round((existing.expenses + info.total) * 100) / 100;
        existing.payments = Math.round((existing.payments + exactPaymentSum) * 100) / 100;
        existing.statementPayment = Math.round((existing.statementPayment + statementPaymentSum) * 100) / 100;
        existing.origens.push(origem);
      } else {
        cycleMap.set(cycleKey, {
          label,
          startStr: '',
          endStr,
          expenses: Math.round(info.total * 100) / 100,
          payments: Math.round(exactPaymentSum * 100) / 100,
          statementPayment: Math.round(statementPaymentSum * 100) / 100,
          balance: 0,
          isPast: endStr <= todayStr,
          origens: [origem],
        });
      }
    }

    const sortedCycles = Array.from(cycleMap.values()).sort((a, b) => a.endStr.localeCompare(b.endStr));

    for (let ci = 0; ci < sortedCycles.length; ci++) {
      const cycle = sortedCycles[ci];
      const nextEndStr = ci + 1 < sortedCycles.length ? sortedCycles[ci + 1].endStr : todayStr;
      const windowPayments = unmappedPayments
        .filter((t) => {
          const d = toLocalDateStr(t.Data);
          return d >= cycle.endStr && d < nextEndStr;
        })
        .reduce((acc, t) => acc + Math.abs(t.Valor), 0);
      cycle.payments = Math.round((cycle.payments + windowPayments) * 100) / 100;
      cycle.balance = Math.max(0, Math.round((cycle.expenses - cycle.payments) * 100) / 100);
    }

    for (let ci = 1; ci < sortedCycles.length; ci++) {
      const paymentForPreviousInvoice = sortedCycles[ci].statementPayment;
      if (paymentForPreviousInvoice > 0) {
        const previous = sortedCycles[ci - 1];
        previous.payments = Math.round((previous.payments + paymentForPreviousInvoice) * 100) / 100;
        previous.balance = Math.max(0, Math.round((previous.expenses - previous.payments) * 100) / 100);
      }
    }

    const allT = transactions.filter((t) => t.ID_Conta === account.id);
    const totalIncome = allT.filter((t) => t.Tipo === 'Renda').reduce((acc, t) => acc + t.Valor, 0);
    const totalExpense = allT.filter((t) => t.Tipo === 'Despesa').reduce((acc, t) => acc + Math.abs(t.Valor), 0);
    totalUsedLimit = Math.abs(Math.min(account.Saldo_Inicial + totalIncome - totalExpense, 0));

    if (diaFecha > 0) {
      const proxFecha =
        hoje < diaFecha
          ? new Date(anoAtual, mesAtual, diaFecha)
          : new Date(anoAtual, mesAtual + 1, diaFecha);
      diasParaFechar = Math.ceil((proxFecha.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }
    if (diaVence > 0) {
      const proxVence =
        hoje <= diaVence
          ? new Date(anoAtual, mesAtual, diaVence)
          : new Date(anoAtual, mesAtual + 1, diaVence);
      diasParaVencer = Math.ceil(
        (proxVence.getTime() - new Date(todayStr).getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    const shouldUseCardSnapshot =
      (cardV2Enabled || cardEngineEnabled) && !!cardV2Snapshot && cardV2Snapshot.hasData;

    const manualOnAccount = allAccountT.some(
      (t) => String(t.Origem || 'manual').trim().toLowerCase() === 'manual'
    );
    /** CSV/import-only: mantém snapshot do motor sem alteração. */
    const useEngineSnapshotOnly = shouldUseCardSnapshot && !manualOnAccount;

    if (useEngineSnapshotOnly) {
      const faturaOpenRounded = roundCurrency(cardV2Snapshot!.currentOpenAmount);
      const ledgerUsedRounded = roundCurrency(Math.max(totalUsedLimit, 0));
      faturaAtual = faturaOpenRounded;
      totalUsedLimit = roundCurrency(Math.max(ledgerUsedRounded, faturaOpenRounded));
    } else {
      const competenceCards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
        accountId: account.id,
        account,
        accounts: accounts.length > 0 ? accounts : [account],
        transactions,
        importLogs,
        rules,
        userPaymentConfirmations,
      });
      const currentCompetence = pickCurrentCompetenceCard(competenceCards, todayStr);
      if (currentCompetence) {
        faturaAtual = Math.max(currentCompetence.openBalance, 0);
      }
      const openFromAllCompetences = competenceCards.reduce(
        (sum, c) => sum + Math.max(c.openBalance, 0),
        0
      );
      totalUsedLimit = roundCurrency(
        Math.max(totalUsedLimit, faturaAtual, openFromAllCompetences)
      );
    }
  }

  const limite = account.limite_credito || 0;
  const limiteUsadoPct = limite > 0 ? Math.min((totalUsedLimit / limite) * 100, 100) : 0;
  const limiteDisponivel = limite > 0 ? Math.max(limite - totalUsedLimit, 0) : 0;
  const barColor =
    limiteUsadoPct > 90 ? 'bg-red-500' : limiteUsadoPct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
  const awaitingMotorSnapshotUi =
    isCreditCard &&
    limite > 0 &&
    cardSnapshotPipelineEnabled &&
    !cardV2Snapshot?.fetchCompleted;

  return {
    isCreditCard,
    currentBalance,
    faturaAtual,
    limite,
    limiteUsadoPct,
    limiteDisponivel,
    barColor,
    diaFecha,
    diaVence,
    diasParaFechar,
    diasParaVencer,
    awaitingMotorSnapshotUi,
  };
}
