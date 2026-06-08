import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppStore } from './../../hooks/useAppStore';
import { formatCurrency, formatCurrencySigned } from '../../utils/formatters';

import { autoStartTour } from '../../services/tourService';
import { loadDemoData } from '../../services/demoDataService';
import { Category, Transaction, Account } from './../../types';
import Card from './../ui/Card';
import ProgressBar from './../ui/ProgressBar';
import SummaryCard from './../ui/SummaryCard';
import NetWorthSummaryCard from '../dashboard/NetWorthSummaryCard';
import Select from './../ui/Select';
import Input from './../ui/Input';
import CategorySpendChart from './../charts/CategorySpendChart';
import IncomeExpenseChart from './../charts/IncomeExpenseChart';
import { TourButton } from '../TourButton';
import MonthlyEvolutionChart from './../charts/MonthlyEvolutionChart';
import { TrendingUpIcon, TrendingDownIcon, CalendarIcon, WalletIcon } from './../ui/icons';
import Rule503020Widget from '../widgets/Rule503020Widget';
import { investmentService } from '../../services/investmentService';
import {
  computeDashboardPeriodMetrics,
  computeInvestmentSummary,
  computeOperationalSummary,
  filterTransactionsByRange,
  toInvestmentData,
  toOperationalChartData,
  buildCategorySets,
} from '../../utils/dashboardMetrics';
import {
  ComparePreset,
  DashboardViewMode,
  defaultComparePreset,
  comparePeriodLabelMode,
  formatCompactPeriodLabel,
  formatDashboardPeriodLabel,
  getCompareDateRange,
  getDashboardDateRange,
  shiftAnchorBack,
  shiftAnchorForward,
} from '../../utils/dashboardPeriod';
import {
  buildCompactComparisonDeltaLabel,
  buildComparisonDeltaLabel,
  computePeriodDelta,
  formatComparisonValue,
} from '../../utils/periodComparison';
import { computeBudgetStatus } from '../../utils/dashboardBudget';
import {
  computeAccountsTotalAsOf,
  computeAssetsTotals,
  computeNetWorthSnapshot,
} from '../../utils/dashboardNetWorth';
import type { SummaryCardComparison } from '../ui/SummaryCard';

import NewTransactionModal from '../modals/NewTransactionModal';
import AccountModal from './AccountModal';
import CategoryModal from '../modals/CategoryModal';

import Button from './../ui/Button';

const DashboardView: React.FC = () => {
  const { transactions, budgets, categories: allCategories, user, isPremium, assets, addTransaction, addCategory, addAccount, updateAccount, accounts, getAccountsWithCalculatedBalance, currentView, setCurrentView, pendingInvites, respondToInvite } = useAppStore();
  const [manualInvestmentsTotal, setManualInvestmentsTotal] = useState(0);
  const [compareManualInvestmentsTotal, setCompareManualInvestmentsTotal] = useState(0);

  // Modal States
  const [isNewTransactionModalOpen, setNewTransactionModalOpen] = useState(false);
  const [isAccountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isCategoryModalOpen, setCategoryModalOpen] = useState(false);
  const [lastCreatedAccount, setLastCreatedAccount] = useState<string | null>(null);
  const [lastCreatedCategory, setLastCreatedCategory] = useState<string | null>(null);
  const [showAssetReviewAlert, setShowAssetReviewAlert] = useState(() => {
    return localStorage.getItem('hideAssetReviewAlert') !== 'true';
  });

  // Auto-start tour logic
  useEffect(() => {
    autoStartTour('dashboard');
  }, []);

  const handleDismissAssetAlert = () => {
    setShowAssetReviewAlert(false);
    localStorage.setItem('hideAssetReviewAlert', 'true');
  };

  // 1. Persistence: Initialize from localStorage
  const [viewMode, setViewMode] = useState<DashboardViewMode>(() => {
    const saved = localStorage.getItem('dashboardViewMode');
    return (saved as DashboardViewMode) || 'monthly';
  });

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [customDateRange, setCustomDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  const [compareEnabled, setCompareEnabled] = useState(() => {
    return localStorage.getItem('dashboardCompareEnabled') === 'true';
  });
  const [comparePreset, setComparePreset] = useState<ComparePreset>(() => {
    const saved = localStorage.getItem('dashboardComparePreset');
    return (saved as ComparePreset) || 'previous';
  });
  const [compareSelectedDate, setCompareSelectedDate] = useState(() => {
    const saved = localStorage.getItem('dashboardCompareAnchor');
    return saved ? new Date(saved) : shiftAnchorBack(new Date(), 'monthly');
  });
  const [compareCustomDateRange, setCompareCustomDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });

  // 2. Persistence: Save to localStorage on change
  const handleViewModeChange = (mode: DashboardViewMode) => {
    setViewMode(mode);
    localStorage.setItem('dashboardViewMode', mode);
    if (compareEnabled) {
      setComparePreset(defaultComparePreset(mode));
      setCompareSelectedDate(shiftAnchorBack(selectedDate, mode));
    }
  };

  const handleToggleCompare = () => {
    setCompareEnabled((prev) => {
      const next = !prev;
      localStorage.setItem('dashboardCompareEnabled', String(next));
      if (next) {
        const preset = defaultComparePreset(viewMode);
        setComparePreset(preset);
        localStorage.setItem('dashboardComparePreset', preset);
        const anchor = shiftAnchorBack(selectedDate, viewMode);
        setCompareSelectedDate(anchor);
        localStorage.setItem('dashboardCompareAnchor', anchor.toISOString());
      }
      return next;
    });
  };

  const handleComparePresetChange = (preset: ComparePreset) => {
    setComparePreset(preset);
    localStorage.setItem('dashboardComparePreset', preset);
    if (preset === 'previous') {
      const anchor = shiftAnchorBack(selectedDate, viewMode);
      setCompareSelectedDate(anchor);
      localStorage.setItem('dashboardCompareAnchor', anchor.toISOString());
    } else if (preset === 'year_over_year') {
      const anchor = new Date(selectedDate);
      anchor.setFullYear(anchor.getFullYear() - 1);
      setCompareSelectedDate(anchor);
      localStorage.setItem('dashboardCompareAnchor', anchor.toISOString());
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const dateRange = useMemo(
    () => getDashboardDateRange({ viewMode, selectedDate, customDateRange }),
    [viewMode, selectedDate, customDateRange]
  );

  const compareDateRange = useMemo(() => {
    if (!compareEnabled) return null;
    return getCompareDateRange(
      dateRange,
      viewMode,
      comparePreset,
      compareSelectedDate,
      compareCustomDateRange
    );
  }, [
    compareEnabled,
    dateRange,
    viewMode,
    comparePreset,
    compareSelectedDate,
    compareCustomDateRange,
  ]);

  useEffect(() => {
    if (!user) return;
    const fetchInvestments = async () => {
      try {
        const data = await investmentService.getLatestInvestments(dateRange.end);
        const total = data.reduce((sum, inv) => sum + Number(inv.balance), 0);
        setManualInvestmentsTotal(total);
      } catch (error) {
        console.error('Error fetching manual investments', error);
      }
    };
    fetchInvestments();
  }, [user, dateRange.end]);

  useEffect(() => {
    if (!user || !compareDateRange) {
      setCompareManualInvestmentsTotal(0);
      return;
    }
    const fetchCompareInvestments = async () => {
      try {
        const data = await investmentService.getLatestInvestments(compareDateRange.end);
        const total = data.reduce((sum, inv) => sum + Number(inv.balance), 0);
        setCompareManualInvestmentsTotal(total);
      } catch (error) {
        console.error('Error fetching compare investments', error);
      }
    };
    fetchCompareInvestments();
  }, [user, compareDateRange]);

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (viewMode === 'custom') return;

    setSelectedDate((prev) => {
      const newDate =
        direction === 'next'
          ? shiftAnchorForward(prev, viewMode)
          : shiftAnchorBack(prev, viewMode);

      if (compareEnabled && comparePreset === 'previous') {
        setCompareSelectedDate(shiftAnchorBack(newDate, viewMode));
      } else if (compareEnabled && comparePreset === 'year_over_year') {
        const yoy = new Date(newDate);
        yoy.setFullYear(yoy.getFullYear() - 1);
        setCompareSelectedDate(yoy);
      }

      return newDate;
    });
  };

  const handleCompareNavigate = (direction: 'prev' | 'next') => {
    if (viewMode === 'custom') return;
    if (comparePreset !== 'custom') return;

    setCompareSelectedDate((prev) =>
      direction === 'next' ? shiftAnchorForward(prev, viewMode) : shiftAnchorBack(prev, viewMode)
    );
  };

  const dateLabel = useMemo(
    () => formatDashboardPeriodLabel(viewMode, dateRange),
    [viewMode, dateRange]
  );

  const compareDateLabel = useMemo(() => {
    if (!compareDateRange) return '';
    const labelMode = comparePeriodLabelMode(viewMode, comparePreset);
    return formatDashboardPeriodLabel(labelMode ?? 'custom', compareDateRange);
  }, [compareDateRange, comparePreset, viewMode]);

  const dateLabelShort = useMemo(
    () => formatCompactPeriodLabel(dateRange),
    [dateRange]
  );

  const compareDateLabelShort = useMemo(
    () => (compareDateRange ? formatCompactPeriodLabel(compareDateRange) : ''),
    [compareDateRange]
  );

  const categorySets = useMemo(() => buildCategorySets(allCategories), [allCategories]);
  const ambosCategories = categorySets.ambos;
  const investmentCategories = categorySets.investment;

  const accountsWithMissingBank = useMemo(() => accounts.filter(acc => !acc.bank_id), [accounts]);

  // 2. Global Data without 'Ambos' (for Evolution Chart which needs history)
  // Also exclude investments from the main evolution chart to show operational evolution
  const transactionsWithoutAmbosAndInvestments = useMemo(() => {
    return transactions.filter(t => !ambosCategories.has(t.Categoria) && !investmentCategories.has(t.Categoria));
  }, [transactions, ambosCategories, investmentCategories]);

  const filteredTransactions = useMemo(
    () => filterTransactionsByRange(transactions, dateRange),
    [transactions, dateRange]
  );

  const chartData = useMemo(
    () => toOperationalChartData(filteredTransactions, categorySets),
    [filteredTransactions, categorySets]
  );

  const investmentData = useMemo(
    () => toInvestmentData(filteredTransactions, categorySets),
    [filteredTransactions, categorySets]
  );

  const compareMetrics = useMemo(() => {
    if (!compareDateRange) return null;
    return computeDashboardPeriodMetrics(transactions, allCategories, compareDateRange);
  }, [compareDateRange, transactions, allCategories]);

  const compareFilteredTransactions = useMemo(
    () => (compareDateRange ? filterTransactionsByRange(transactions, compareDateRange) : []),
    [transactions, compareDateRange]
  );

  const compareChartData = useMemo(
    () => toOperationalChartData(compareFilteredTransactions, categorySets),
    [compareFilteredTransactions, categorySets]
  );

  const netWorthSnapshot = useMemo(() => {
    const { gross, debts, net } = computeAssetsTotals(assets);
    const accountsTotalValue = compareEnabled
      ? computeAccountsTotalAsOf(accounts, transactions, dateRange.end)
      : getAccountsWithCalculatedBalance().reduce(
          (sum, acc) => sum + (acc.Saldo_Atual_Calculado || 0),
          0
        );

    return {
      total: accountsTotalValue + manualInvestmentsTotal + net,
      accounts: accountsTotalValue,
      investments: manualInvestmentsTotal,
      assetsNet: net,
      assetsGross: gross,
      assetsDebts: debts,
    };
  }, [
    compareEnabled,
    accounts,
    transactions,
    assets,
    manualInvestmentsTotal,
    dateRange.end,
    getAccountsWithCalculatedBalance,
  ]);

  const compareNetWorthSnapshot = useMemo(() => {
    if (!compareDateRange) return null;
    return computeNetWorthSnapshot(
      accounts,
      transactions,
      assets,
      compareManualInvestmentsTotal,
      compareDateRange.end
    );
  }, [accounts, transactions, assets, compareManualInvestmentsTotal, compareDateRange]);

  const {
    total: totalNetWorth,
    accounts: accountsTotal,
    investments: manualInvestmentsDisplay,
    assetsNet: assetsNetTotal,
    assetsGross: grossAssetsTotal,
    assetsDebts: assetsDebtsTotal,
  } = netWorthSnapshot;

  const summary = useMemo(() => computeOperationalSummary(chartData), [chartData]);
  const investmentSummary = useMemo(
    () => computeInvestmentSummary(investmentData),
    [investmentData]
  );

  const buildCardComparison = useCallback(
    (
      current: number,
      previous: number,
      direction: 'higher_better' | 'lower_better',
      options?: { asNegativeExpense?: boolean; usePercentagePoints?: boolean }
    ): SummaryCardComparison | undefined => {
      if (!compareEnabled || !compareMetrics) return undefined;
      const delta = computePeriodDelta(current, previous);
      const { label, tone } = buildCompactComparisonDeltaLabel(delta, direction, {
        usePercentagePoints: options?.usePercentagePoints,
        current,
        previous,
      });
      return {
        periodLabel: compareDateLabelShort,
        value: formatComparisonValue(previous, options?.asNegativeExpense),
        deltaLabel: label,
        deltaTone: tone,
      };
    },
    [compareEnabled, compareMetrics, compareDateLabelShort]
  );

  const budgetStatus = useMemo(
    () => computeBudgetStatus(budgets, filteredTransactions, viewMode, dateRange),
    [budgets, filteredTransactions, viewMode, dateRange]
  );

  const compareBudgetStatus = useMemo(() => {
    if (!compareDateRange) return null;
    return computeBudgetStatus(
      budgets,
      compareFilteredTransactions,
      viewMode,
      compareDateRange,
      compareDateRange.end
    );
  }, [budgets, compareFilteredTransactions, viewMode, compareDateRange]);

  const compareBudgetMap = useMemo(() => {
    if (!compareBudgetStatus) return new Map<string, number>();
    return new Map(compareBudgetStatus.map((item) => [item.Categoria, item.spent]));
  }, [compareBudgetStatus]);

  // Últimas Transações
  const recentTransactions = useMemo(() => {
    return [...filteredTransactions]
      .sort((a, b) => {
        const dateA = a.Data_Pagamento ? new Date(a.Data_Pagamento).getTime() : new Date(a.Data).getTime();
        const dateB = b.Data_Pagamento ? new Date(b.Data_Pagamento).getTime() : new Date(b.Data).getTime();
        return dateB - dateA;
      })
      .slice(0, 5);
  }, [filteredTransactions]);



  const categoryTypeMap = useMemo(() =>
    new Map(allCategories.map(c => [c.Nome_Categoria, c.Tipo]))
    , [allCategories]);

  const categoryTypeColorMap: Record<Category['Tipo'], string> = { Renda: 'text-accent', Despesa: 'text-danger', Ambos: 'text-highlight' };

  const getSavingsRateInfo = (rate: number) => {
    if (rate < 0) return { label: 'Crítico', color: 'danger' as const, desc: 'Gastos superaram ganhos.' };
    if (rate < 10) return { label: 'Baixo', color: 'warning' as const, desc: 'Margem de segurança pequena. O ideal é acima de 20% para superar a inflação real.' };
    if (rate < 20) return { label: 'Bom', color: 'default' as const, desc: 'Bom começo! Tente buscar 20-30% para crescer seu patrimônio.' };
    if (rate < 30) return { label: 'Ótimo', color: 'success' as const, desc: 'Excelente! Você está construindo riqueza de forma sólida.' };
    return { label: 'Excelente', color: 'accent' as const, desc: 'Nível excepcional de acumulação de riqueza. Liberdade financeira à vista!' };
  };

  const savingsInfo = getSavingsRateInfo(summary.savingsRate);

  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Bom dia' : currentHour < 18 ? 'Boa tarde' : 'Boa noite';

  // Get user name logic
  const getFirstName = () => {
    const metadataName = user?.user_metadata?.full_name || user?.user_metadata?.name;
    if (metadataName) return metadataName.split(' ')[0];

    const emailName = user?.email?.split('@')[0];
    if (emailName) {
      // Capitalize first letter
      return emailName.charAt(0).toUpperCase() + emailName.slice(1);
    }

    return 'Investidor';
  };

  const displayName = getFirstName();

  const handleNewSave = async (newTransactions: Omit<Transaction, 'ID_Transacao' | 'Origem'>[]) => {
    const payloads = newTransactions.map((t) => ({
      Data: t.Data,
      ID_Conta: t.ID_Conta,
      Data_Pagamento: t.Data_Pagamento,
      Nome_Fantasia: t.Nome_Fantasia,
      Categoria: t.Categoria,
      Tipo: t.Tipo,
      Valor: t.Valor,
      Parcela_Atual: t.Parcela_Atual,
      Total_Parcelas: t.Total_Parcelas,
      Fonte: t.Fonte,
      Origem: 'manual' as const,
      Descricao_Original: t.Nome_Fantasia,
    }));
    await addTransaction(payloads.length === 1 ? payloads[0] : payloads);
    setNewTransactionModalOpen(false);
  };

  const handleSaveCategory = async (categoryData: Omit<Category, 'id'>) => {
    const result = await addCategory(categoryData);
    if (result.status === 'created') {
      setLastCreatedCategory(categoryData.Nome_Categoria);
      setCategoryModalOpen(false);
    }
  };

  const handleSaveAccount = async (accountData: Omit<Account, 'id' | 'user_id'>) => {
    if (editingAccount) {
        await updateAccount({ id: editingAccount.id, ...accountData });
        setAccountModalOpen(false);
        setEditingAccount(null);
    } else {
        const newAccount = await addAccount(accountData);
        if (newAccount) {
          setLastCreatedAccount(newAccount.id);
          setAccountModalOpen(false);
        }
    }
  };

  return (
    <div id="dashboard-content" className="space-y-8 print:space-y-4 pb-12">

      {/* Header Section */}
      <div className="flex flex-col lg:flex-row justify-between items-end gap-6 pb-2 no-print">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
            {greeting}, <span className="text-accent">{displayName}</span>
          </h1>
          <p className="text-gray-400">Aqui está o resumo da sua saúde financeira hoje.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block text-right mr-4">
            <div className="text-xs text-gray-500 uppercase font-bold tracking-wider">
              {compareEnabled ? 'Comparando períodos' : 'Período selecionado'}
            </div>
            <div className="text-sm font-medium text-white">
              {compareEnabled ? (
                <>
                  <span className="text-accent">{dateLabelShort}</span>
                  <span className="text-gray-500 mx-1.5">vs</span>
                  <span>{compareDateLabelShort}</span>
                </>
              ) : (
                dateLabel
              )}
            </div>
          </div>
          <TourButton currentView="dashboard" />
        </div>
      </div>

      {/* Empty State / Demo Data CTA */}
      {transactions.length === 0 && (
        <div className="bg-gradient-to-r from-secondary to-primary/50 rounded-xl p-6 border border-accent/20 shadow-lg mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in-up">
          <div className="flex items-center gap-4">
            <div className="bg-accent/20 p-3 rounded-full">
              <span className="text-2xl">🚀</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-light">Novo por aqui?</h3>
              <p className="text-gray-400 text-sm">Carregue dados de exemplo para ver o poder do FinElo em ação instantaneamente.</p>
            </div>
          </div>
          <button
            onClick={loadDemoData}
            className="px-6 py-2 bg-accent hover:bg-accent/80 text-white font-bold rounded-lg transition-all shadow-md hover:shadow-accent/20 whitespace-nowrap"
          >
            Carregar Demo
          </button>
        </div>
      )}

      {/* Family Invites Banner */}
      {pendingInvites.length > 0 && (
        <div className="bg-gradient-to-r from-blue-900/40 to-indigo-900/40 rounded-xl p-5 border border-blue-500/30 shadow-xl mb-6 flex flex-col lg:flex-row items-center justify-between gap-6 animate-fade-in-up overflow-hidden">
          <div className="flex items-center gap-4 text-center lg:text-left flex-1 min-w-0">
            <div className="bg-blue-500/20 p-3 rounded-full flex-shrink-0 hidden sm:flex">
              <span className="text-2xl">👨‍👩‍👧‍👦</span>
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-white leading-tight">Convite para Plano Família</h3>
              <p className="text-blue-100/70 text-sm mt-1 leading-relaxed">
                O usuário <b>{pendingInvites[0].owner_email || 'Um usuário'}</b> te convidou para compartilhar uma conta premium.
                Aceite para herdar os benefícios e visualizar as contas compartilhadas.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full lg:w-auto shrink-0 justify-center">
            <button
              onClick={() => respondToInvite(pendingInvites[0].id, 'declined')}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-lg transition-colors border border-white/10 text-sm whitespace-nowrap"
            >
              Recusar
            </button>
            <button
              onClick={() => respondToInvite(pendingInvites[0].id, 'accepted')}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-400 text-white font-bold rounded-lg transition-all shadow-lg shadow-blue-500/20 text-sm whitespace-nowrap"
            >
              Aceitar Convite
            </button>
          </div>
        </div>
      )}

      {/* Asset Review Alert */}
      {showAssetReviewAlert && assets.length > 0 && !assets.some(a => a.is_financed) && (
        <div className="bg-gradient-to-r from-amber-600/30 to-orange-700/30 rounded-xl p-5 border border-amber-500/30 shadow-lg mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in-up">
          <div className="flex items-center gap-4">
            <div className="bg-amber-500/20 p-3 rounded-full flex-shrink-0">
                <span className="text-2xl">🚜</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Revise seus Patrimônios</h3>
              <p className="text-amber-100/80 text-sm">
                Agora você pode detalhar <b>financiamentos e dívidas</b> dos seus bens para ver seu Patrimônio Líquido real!
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
               onClick={handleDismissAssetAlert}
               className="text-xs text-amber-200/50 hover:text-white transition-colors underline px-2"
            >
              Ignorar
            </button>
            <button
              onClick={() => setCurrentView('settings')}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg transition-all shadow-md shadow-amber-500/20 text-sm whitespace-nowrap"
            >
              Revisar Agora
            </button>
          </div>
        </div>
      )}

      {/* Bank Identifier Alert */}
      {accountsWithMissingBank.length > 0 && (
        <div className="bg-gradient-to-r from-highlight/30 to-accent/20 rounded-xl p-5 border border-highlight/30 shadow-lg mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in-up">
          <div className="flex items-center gap-4">
            <div className="bg-highlight/20 p-3 rounded-full flex-shrink-0">
                <span className="text-2xl">🏦</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Identifique seus bancos</h3>
              <p className="text-highlight/80 text-sm">
                Seus cards de conta ficarão muito mais bonitos com os <b>logos oficiais</b>. Configure agora!
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const firstAccount = accountsWithMissingBank[0];
                setEditingAccount(firstAccount);
                setAccountModalOpen(true);
              }}
              className="px-5 py-2 bg-highlight hover:bg-highlight/80 text-white font-bold rounded-lg transition-all shadow-md shadow-highlight/20 text-sm whitespace-nowrap"
            >
              Identificar Banco
            </button>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div id="dashboard-header" className="bg-white/5 backdrop-blur-md p-2 rounded-2xl border border-white/5 shadow-lg print:hidden space-y-2">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          {viewMode === 'custom' ? (
            <div className="flex items-center gap-2 p-2 w-full sm:w-auto">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 shrink-0">Principal</span>
              <Input type="date" value={customDateRange.start} onChange={(e) => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))} className="w-36 bg-black/20 border-white/10" />
              <span className="text-gray-400">até</span>
              <Input type="date" value={customDateRange.end} onChange={(e) => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))} className="w-36 bg-black/20 border-white/10" />
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-black/20 rounded-xl p-1 w-full sm:w-auto justify-between sm:justify-start">
              <button onClick={() => handleNavigate('prev')} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <span className="text-sm font-bold text-white capitalize w-32 text-center select-none truncate">{dateLabel}</span>
              <button onClick={() => handleNavigate('next')} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto p-1">
            <div className="w-full sm:w-40">
              <Select value={viewMode} onChange={(e) => handleViewModeChange(e.target.value as DashboardViewMode)} className="w-full bg-black/20 border-white/10 text-sm">
                <option value="monthly">Mensal</option>
                <option value="quarterly">Trimestral</option>
                <option value="semiannual">Semestral</option>
                <option value="yearly">Anual</option>
                <option value="custom">Personalizado</option>
              </Select>
            </div>
            <Button
              variant={compareEnabled ? 'primary' : 'secondary'}
              onClick={handleToggleCompare}
              className={`w-full sm:w-auto text-sm ${compareEnabled ? '' : 'border-white/10 hover:bg-white/10'}`}
            >
              {compareEnabled ? 'Comparando' : 'Comparar'}
            </Button>
            <Button variant="secondary" onClick={handlePrint} className="w-full sm:w-auto text-sm border-white/10 hover:bg-white/10">Exportar PDF</Button>
          </div>
        </div>

        {compareEnabled && (
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 px-2 pb-1 border-t border-white/5 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Comparar com</span>
              <button
                type="button"
                onClick={() => handleComparePresetChange('previous')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${comparePreset === 'previous' ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-black/20 text-gray-400 hover:text-white border border-white/5'}`}
              >
                Período anterior
              </button>
              <button
                type="button"
                onClick={() => handleComparePresetChange('year_over_year')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${comparePreset === 'year_over_year' ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-black/20 text-gray-400 hover:text-white border border-white/5'}`}
              >
                Mesmo período, ano anterior
              </button>
              <button
                type="button"
                onClick={() => handleComparePresetChange('custom')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${comparePreset === 'custom' ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-black/20 text-gray-400 hover:text-white border border-white/5'}`}
              >
                Escolher período
              </button>
            </div>

            {comparePreset === 'custom' && (
              viewMode === 'custom' ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <Input type="date" value={compareCustomDateRange.start} onChange={(e) => setCompareCustomDateRange(prev => ({ ...prev, start: e.target.value }))} className="w-36 bg-black/20 border-white/10" />
                  <span className="text-gray-400">até</span>
                  <Input type="date" value={compareCustomDateRange.end} onChange={(e) => setCompareCustomDateRange(prev => ({ ...prev, end: e.target.value }))} className="w-36 bg-black/20 border-white/10" />
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-black/20 rounded-xl p-1 w-full sm:w-auto justify-between sm:justify-start">
                  <button onClick={() => handleCompareNavigate('prev')} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <span className="text-sm font-bold text-white capitalize w-32 text-center select-none truncate">{compareDateLabel}</span>
                  <button onClick={() => handleCompareNavigate('next')} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
              )
            )}

            {comparePreset !== 'custom' && (
              <span className="text-xs text-gray-500 lg:ml-auto">{compareDateLabel}</span>
            )}
          </div>
        )}
      </div>

      {/* KPIs Cards */}
      <div id="dashboard-kpis" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6 items-stretch">
        <SummaryCard
          title="Entradas (Operacional)"
          value={formatCurrency(summary.income)}
          icon={<TrendingUpIcon />}
          variant={summary.income === 0 ? 'default' : 'accent'}
          tooltip="Soma dos ganhos (salários, vendas), excluindo resgates de investimentos."
          compare={buildCardComparison(
            summary.income,
            compareMetrics?.operational.income ?? 0,
            'higher_better'
          )}
        />
        <SummaryCard
          title="Saídas (Operacional)"
          value={formatCurrency(-summary.expense)}
          icon={<TrendingDownIcon />}
          variant={summary.expense === 0 ? 'default' : 'danger'}
          tooltip="Soma dos gastos, excluindo dinheiro enviado para investimentos."
          compare={buildCardComparison(
            summary.expense,
            compareMetrics?.operational.expense ?? 0,
            'lower_better',
            { asNegativeExpense: true }
          )}
        />
        <SummaryCard
          title="Resultado Operacional"
          value={formatCurrency(summary.balance)}
          icon={<TrendingUpIcon />}
          variant={summary.balance === 0 ? 'default' : (summary.balance > 0 ? 'accent' : 'danger')}
          subValue={`${summary.savingsRate.toFixed(1)}% de Economia`}
          tooltip="Lucro ou Prejuízo das operações do mês. Não inclui saldo anterior nem investimentos."
          compare={buildCardComparison(
            summary.balance,
            compareMetrics?.operational.balance ?? 0,
            'higher_better'
          )}
        />
        <SummaryCard
          title="Economia"
          value={`${summary.savingsRate.toFixed(1)}%`}
          icon={<TrendingUpIcon />}
          variant={summary.savingsRate === 0 ? 'default' : (summary.savingsRate > 0 ? 'accent' : savingsInfo.color)}
          subValue={savingsInfo.label}
          tooltip={`Taxa de Poupança: ${savingsInfo.desc}`}
          compare={buildCardComparison(
            summary.savingsRate,
            compareMetrics?.operational.savingsRate ?? 0,
            'higher_better',
            { usePercentagePoints: true }
          )}
        />
        <SummaryCard
          title="Investimentos (Mês)"
          value={formatCurrency(investmentSummary.netFlow)}
          icon={<WalletIcon />}
          variant={investmentSummary.netFlow === 0 ? 'default' : (investmentSummary.netFlow > 0 ? 'accent' : 'danger')}
          subValue={`Aportes: ${formatCurrency(investmentSummary.invested)} • Resgates: ${formatCurrency(investmentSummary.withdrawn)}`}
          tooltip="Dinheiro efetivamente guardado (Aportes - Resgates/Retiradas)."
          compare={buildCardComparison(
            investmentSummary.netFlow,
            compareMetrics?.investment.netFlow ?? 0,
            'higher_better'
          )}
        />
        <NetWorthSummaryCard
          total={totalNetWorth}
          accounts={accountsTotal}
          investments={manualInvestmentsDisplay}
          assetsNet={assetsNetTotal}
          assetsGross={grossAssetsTotal}
          assetsDebts={assetsDebtsTotal}
          asOfLabel={compareEnabled ? dateLabel : undefined}
          primaryPeriodLabel={compareEnabled ? dateLabelShort : undefined}
          compare={
            compareEnabled && compareNetWorthSnapshot
              ? (() => {
                  const delta = computePeriodDelta(
                    totalNetWorth,
                    compareNetWorthSnapshot.total
                  );
                  const { label, tone } = buildComparisonDeltaLabel(delta, 'higher_better');
                  return {
                    periodLabel: compareDateLabelShort,
                    breakdown: compareNetWorthSnapshot,
                    deltaLabel: label,
                    deltaTone: tone,
                  };
                })()
              : undefined
          }
        />
      </div>

      {/* Charts Row 1 — Evolução Financeira */}
      <div id="dashboard-charts-main" className="grid grid-cols-1 gap-6">
        <Card
          title={
            viewMode === 'yearly' ? `Evolução Anual (${selectedDate.getFullYear()})` :
              viewMode === 'monthly' ? `Tendência (Últimos 6 Meses até ${selectedDate.toLocaleDateString('pt-BR', { month: 'long' })})` :
                viewMode === 'quarterly' ? `Evolução Trimestral` :
                  viewMode === 'semiannual' ? `Evolução Semestral` :
                    "Evolução Financeira"
          }
          className="relative overflow-hidden"
        >
          <div className={!isPremium ? "blur-sm opacity-50 pointer-events-none select-none" : ""}>
            <MonthlyEvolutionChart
              data={transactionsWithoutAmbosAndInvestments}
              viewMode={viewMode}
              selectedDate={selectedDate}
              compareEnabled={compareEnabled}
              compareData={compareEnabled ? transactionsWithoutAmbosAndInvestments : undefined}
              primaryPeriodData={compareEnabled ? chartData : undefined}
              comparePeriodData={compareEnabled ? compareChartData : undefined}
              compareSelectedDate={compareSelectedDate}
              primaryLabel={dateLabelShort}
              compareLabel={compareDateLabelShort}
            />
          </div>
          {!isPremium && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center no-print">
              <div className="bg-slate-900/80 backdrop-blur-md border border-yellow-500/30 p-6 rounded-2xl shadow-2xl max-w-sm flex flex-col items-center">
                <svg className="w-12 h-12 text-yellow-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                <h3 className="text-xl font-bold text-white mb-2">Recurso Premium</h3>
                <p className="text-sm text-gray-300 mb-6 font-medium">Desbloqueie a Evolução Financeira detalhada para visualizar seu histórico e tendências.</p>
                <button onClick={() => setCurrentView('pricing')} className="px-6 py-2.5 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-400 hover:to-yellow-500 text-slate-900 font-bold rounded-xl transition-all shadow-lg shadow-yellow-500/20 text-sm w-full">Fazer Upgrade</button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Receita vs. Despesa — linha dedicada */}
      <div id="dashboard-charts-income-expense" className="grid grid-cols-1 gap-6">
        <Card title="Receita vs. Despesa">
          <IncomeExpenseChart
            data={chartData}
            compareData={compareEnabled ? compareChartData : undefined}
            primaryLabel={dateLabelShort}
            compareLabel={compareDateLabelShort}
          />
        </Card>
      </div>

      {/* Charts Row 2 & Recent Transactions */}
      <div id="dashboard-charts-secondary" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Despesas por Categoria" className="lg:col-span-2 relative overflow-hidden">
          <div className={!isPremium ? "blur-sm opacity-50 pointer-events-none select-none" : ""}>
            <CategorySpendChart
              data={chartData}
              compareData={compareEnabled ? compareChartData : undefined}
              primaryLabel={dateLabelShort}
              compareLabel={compareDateLabelShort}
            />
          </div>
          {!isPremium && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center no-print">
              <div className="bg-slate-900/80 backdrop-blur-md border border-yellow-500/30 p-6 rounded-2xl shadow-2xl max-w-sm flex flex-col items-center">
                <svg className="w-10 h-10 text-yellow-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                <h3 className="text-lg font-bold text-white mb-2">Despesas por Categoria</h3>
                <p className="text-sm text-gray-300 mb-4">Veja exatamente onde seu dinheiro está indo com o plano Premium.</p>
                <button onClick={() => setCurrentView('pricing')} className="px-5 py-2 bg-yellow-500/20 hover:bg-yellow-500 text-yellow-500 hover:text-slate-900 font-bold rounded-lg transition-colors border border-yellow-500/50 text-sm">Desbloquear Funcionalidade</button>
              </div>
            </div>
          )}
        </Card>

        <Card title="Últimas Transações">
          {recentTransactions.length > 0 ? (
            <div className="space-y-3">
              {recentTransactions.map(t => (
                <div key={t.ID_Transacao} className="flex justify-between items-center p-2 hover:bg-primary rounded transition-colors">
                  <div className="overflow-hidden">
                    <p className="font-semibold text-sm truncate text-light">{t.Nome_Fantasia}</p>
                    <p className="text-xs text-gray-500">{new Date(t.Data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} • {t.Categoria}</p>
                  </div>
                  <span className={`font-bold text-sm ${t.Tipo === 'Renda' ? 'text-accent' : 'text-danger'}`}>
                    {formatCurrencySigned(t.Tipo === 'Despesa' ? -Math.abs(t.Valor) : Math.abs(t.Valor), { showPlusForPositive: true })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-4">Sem transações no período.</p>
          )}
        </Card>
      </div>

      {/* Budget Alerts & Financial Health — uma linha por card */}
      <div id="dashboard-budgets" className="grid grid-cols-1 gap-6">
        <Card title="Monitoramento de Orçamento">
          {budgetStatus.length > 0 ? (
            <div className="space-y-4">
              {compareEnabled && (
                <p className="text-[10px] text-gray-500 pb-2 border-b border-slate-700/50">
                  <span className="text-accent font-semibold">{dateLabelShort}</span>
                  <span className="mx-1.5">vs</span>
                  <span className="text-slate-300 font-semibold">{compareDateLabelShort}</span>
                </p>
              )}
              <div className="flex flex-wrap gap-4 mb-4 text-[10px] text-gray-400 border-b border-slate-700/50 pb-3">
                <div className="flex items-center gap-1.5" title="Gastos dentro do ritmo esperado para a data atual.">
                  <div className="w-2 h-2 rounded-full bg-accent"></div>
                  <span>No Foco</span>
                </div>
                <div className="flex items-center gap-1.5" title="Atenção: Ritmo de gastos ligeiramente acima do ideal (5% a 20%).">
                  <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                  <span>Atenção</span>
                </div>
                <div className="flex items-center gap-1.5" title="Crítico: Ritmo de gastos muito alto (>20%) ou limite já estourado.">
                  <div className="w-2 h-2 rounded-full bg-danger"></div>
                  <span>Risco / Estouro</span>
                </div>
              </div>

              {budgetStatus.map(item => {
                const compareSpent = compareBudgetMap.get(item.Categoria) || 0;
                const spentDelta = compareEnabled
                  ? buildCompactComparisonDeltaLabel(
                      computePeriodDelta(item.spent, compareSpent),
                      'lower_better'
                    )
                  : null;

                const consumedPct =
                  item.adjustedLimit > 0 ? ((item.spent / item.adjustedLimit) * 100).toFixed(1) : '0.0';

                return (
                  <div key={item.id}>
                    <div
                      className={`grid gap-3 items-center ${
                        compareEnabled
                          ? 'grid-cols-1 md:grid-cols-[minmax(0,120px)_minmax(0,1fr)_minmax(0,200px)_minmax(0,160px)]'
                          : 'grid-cols-1 sm:grid-cols-4'
                      }`}
                    >
                      <span className="font-semibold text-light">{item.Categoria}</span>
                      <div className={compareEnabled ? '' : 'col-span-2'}>
                        <ProgressBar
                          value={item.spent}
                          max={item.adjustedLimit}
                          expectedPacing={item.pacingRatio}
                        />
                      </div>
                      {compareEnabled ? (
                        <>
                          <div className="rounded-lg px-3 py-2.5 text-right bg-accent/[0.06] border border-accent/20 min-w-0">
                            <p className="text-[9px] font-bold uppercase text-accent truncate mb-1">
                              {dateLabelShort}
                            </p>
                            <p className="text-sm leading-tight tabular-nums">
                              <span
                                className={
                                  item.spent > item.adjustedLimit ? 'text-danger font-bold' : 'text-gray-200'
                                }
                              >
                                {formatCurrency(item.spent)}
                              </span>
                              <span className="text-gray-500 text-xs">
                                {' '}
                                / {formatCurrency(item.adjustedLimit)}
                              </span>
                            </p>
                            <p className="text-[10px] text-gray-400">{consumedPct}% consumido</p>
                            {spentDelta && (
                              <p
                                className={`text-[10px] font-semibold mt-1 ${
                                  spentDelta.tone === 'positive'
                                    ? 'text-accent'
                                    : spentDelta.tone === 'negative'
                                      ? 'text-danger'
                                      : 'text-gray-500'
                                }`}
                              >
                                {spentDelta.label}
                              </p>
                            )}
                          </div>
                          <div className="rounded-lg px-3 py-2.5 text-right bg-black/25 border border-white/8 min-w-0">
                            <p className="text-[9px] font-bold uppercase text-slate-400 truncate mb-1">
                              {compareDateLabelShort}
                            </p>
                            <p className="text-sm text-slate-300 font-semibold tabular-nums">
                              {formatCurrency(compareSpent)}
                            </p>
                            <p className="text-[10px] text-gray-500">gasto no período</p>
                          </div>
                        </>
                      ) : (
                        <div className="col-span-1 text-right flex flex-col justify-center gap-0.5">
                          <div className="text-sm leading-tight">
                            <span
                              className={
                                item.spent > item.adjustedLimit ? 'text-danger font-bold' : 'text-gray-300'
                              }
                            >
                              {formatCurrency(item.spent)}
                            </span>
                            <span className="text-gray-500 hidden sm:inline">
                              {' '}
                              / {formatCurrency(item.adjustedLimit)}
                            </span>
                          </div>
                          <div className="text-xs text-gray-400">{consumedPct}% consumido</div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-gray-400 py-4">Nenhum orçamento configurado. Vá para Configurações para adicionar.</p>
          )}
        </Card>

        {/* 50-30-20 Rule Widget */}
        <Card title="Método 50-30-20 (Saúde Financeira)" className="relative overflow-hidden">
          <div className="mb-4 space-y-2">
            <p className="text-sm text-gray-400">
              Analisa como sua renda líquida está distribuída entre Necessidades, Estilo de Vida e Investimentos.
            </p>
            {compareEnabled && (
              <p className="text-[10px] text-gray-500">
                <span className="text-accent font-semibold">{dateLabelShort}</span>
                <span className="mx-1.5">vs</span>
                <span className="text-slate-300 font-semibold">{compareDateLabelShort}</span>
              </p>
            )}
          </div>
          <div className={!isPremium ? "blur-md opacity-40 pointer-events-none select-none" : ""}>
            <Rule503020Widget
              income={summary.income}
              operationalExpenses={chartData}
              savings={investmentSummary.netFlow}
              categories={allCategories}
              primaryLabel={dateLabelShort}
              compareLabel={compareDateLabelShort}
              compare={
                compareEnabled && compareMetrics
                  ? {
                      label: compareDateLabelShort,
                      income: compareMetrics.operational.income,
                      operationalExpenses: compareChartData,
                      savings: compareMetrics.investment.netFlow,
                    }
                  : undefined
              }
            />
          </div>
          {!isPremium && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center mt-8 no-print">
              <div className="bg-slate-900/90 backdrop-blur-sm border border-yellow-500/30 p-6 rounded-2xl shadow-2xl max-w-sm flex flex-col items-center">
                <svg className="w-10 h-10 text-yellow-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                <h3 className="text-lg font-bold text-white mb-2">Diagnóstico Inteligente</h3>
                <p className="text-sm text-gray-300 mb-4">Descubra sua nota de saúde financeira e se está gastando demais em estilo de vida com o plano Premium.</p>
                <button onClick={() => setCurrentView('pricing')} className="px-5 py-2 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold rounded-lg transition-colors shadow-[0_0_15px_rgba(234,179,8,0.3)] text-sm">Seja Premium Mantenha o Foco</button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Mobile Floating Action Button (FAB) */}
      <button
        onClick={() => setNewTransactionModalOpen(true)}
        className="fixed lg:hidden bottom-24 landscape:max-lg:bottom-10 right-6 sm:right-10 w-14 h-14 bg-highlight hover:bg-sky-400 text-white rounded-full shadow-[0_4px_14px_rgba(56,189,248,0.5)] flex items-center justify-center transition-transform active:scale-95 z-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-primary focus:ring-highlight"
        aria-label="Nova Transação"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Modais */}
      {isNewTransactionModalOpen && (
        <NewTransactionModal
          transaction={null}
          onClose={() => setNewTransactionModalOpen(false)}
          onSave={handleNewSave}
          accounts={useAppStore.getState().accounts} // Get directly to avoid stale closured state if needed, but props are usually fine
          categories={allCategories}
          assets={assets}
          onOpenCreateAccount={() => setAccountModalOpen(true)}
          onOpenCreateCategory={() => setCategoryModalOpen(true)}
          lastCreatedAccount={lastCreatedAccount}
          lastCreatedCategory={lastCreatedCategory}
        />
      )}

      {isAccountModalOpen && (
        <AccountModal
          account={editingAccount}
          onClose={() => {
            setAccountModalOpen(false);
            setEditingAccount(null);
          }}
          onSave={handleSaveAccount}
        />
      )}

      {isCategoryModalOpen && (
        <CategoryModal
          category={null}
          onClose={() => setCategoryModalOpen(false)}
          onSave={handleSaveCategory}
        />
      )}
    </div>
  );
};

export default DashboardView;
