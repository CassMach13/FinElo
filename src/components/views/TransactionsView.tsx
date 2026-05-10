import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAppStore } from '../../hooks/useAppStore';
import { appAlert, appConfirm } from '../../hooks/useDialogStore';
import { Transaction, Category, MappingRule, Account } from './../../types';
import Card from './../ui/Card';
import Modal from './../ui/Modal';
import Input from './../ui/Input';
import MultiSelect from './../ui/MultiSelect';
import Select from './../ui/Select';
import Button from './../ui/Button';
import { TourButton } from '../TourButton';

import { formatCurrency } from '../../utils/formatters';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import AccountModal from './AccountModal';
import CategoryModal from '../modals/CategoryModal';
import NewTransactionModal from '../modals/NewTransactionModal';
import MappingRuleModal from '../modals/MappingRuleModal';
import { SwipeableItem } from '../ui/SwipeableItem';
import { SkeletonCard } from '../ui/Skeleton';
import { NATIVE_BANK_CONFIGS } from '../../services/parsers/nativeBankParsers';

const TransactionsView: React.FC = () => {
  const { transactions, accounts, assets, fetchAllData, isLoading, getSortedCategories, addTransaction, updateTransaction, deleteTransaction, deleteTransactionsByOrigin, addMappingRule, transactionFilters, setTransactionFilters, addCategory, addAccount, updateAccount, getAccountsWithCalculatedBalance } = useAppStore();
  const [isNewTransactionModalOpen, setNewTransactionModalOpen] = useState(false);
  const [isCategoryModalOpen, setCategoryModalOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ transactionId: string; origin: string; count: number } | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Transaction; direction: 'ascending' | 'descending' }>({ key: 'Data', direction: 'descending' });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [predefinedTransaction, setPredefinedTransaction] = useState<Transaction | null>(null);

  const handlePayInvoice = (account: Account, amount: number) => {
    const paymentTx: any = {
      Tipo: 'Renda',
      ID_Conta: account.id,
      Nome_Fantasia: 'Pagamento de Fatura',
      Categoria: 'Pagamento de Fatura',
      Data: new Date(),
      Valor: amount,
      Descricao_Original: 'Lançamento Manual (Atalho)'
    };
    setPredefinedTransaction(paymentTx);
    setNewTransactionModalOpen(true);
  };

  const [isMappingRuleModalOpen, setMappingRuleModalOpen] = useState(false);
  const [transactionForRule, setTransactionForRule] = useState<Transaction | null>(null);

  // New Modals State
  const [isAccountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [lastCreatedAccount, setLastCreatedAccount] = useState<string | null>(null);
  const [lastCreatedCategory, setLastCreatedCategory] = useState<string | null>(null);

  const categories = getSortedCategories();
  const accountsWithMissingBank = useMemo(() => accounts.filter(acc => !acc.bank_id && !acc.is_archived), [accounts]);

  // Efeito para buscar as transações do Supabase na montagem do componente
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const accountsMap = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach(acc => map.set(acc.id, acc.Nome_Conta));
    return map;
  }, [accounts]);

  const processDataForExport = (dataToExport: Transaction[]) => {
    return dataToExport.map(t => ({
      'Data': new Date(t.Data).toLocaleDateString('pt-BR'),
      'Descrição Personalizada (Usuário)': t.Nome_Fantasia || '',
      'Descrição Original (Banco)': t.Descricao_Original || '',
      'Categoria': t.Categoria || '',
      'Tipo': t.Tipo || '',
      'Valor': t.Valor,
      'Conta': accountsMap.get(t.ID_Conta) || 'N/A',
      'Parcelas': t.Parcela_Atual ? `${t.Parcela_Atual}/${t.Total_Parcelas || 1}` : '',
      'Tags': t.Tags ? t.Tags.join(', ') : '',
      'Observações': t.Observacoes || ''
    }));
  };

  const handleExportCSV = () => {
    const data = processDataForExport(filteredTransactions);
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `transacoes_filtradas_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = () => {
    const data = processDataForExport(filteredTransactions);
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transações");
    XLSX.writeFile(workbook, `transacoes_filtradas_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === 'csv') handleExportCSV();
    if (value === 'excel') handleExportExcel();
    // Reset select value
    e.target.value = '';
  };

  const filteredTransactions = useMemo(() => {
    let sortableItems = [...transactions];

    sortableItems.sort((a, b) => {
      const aValue = a[sortConfig.key as keyof Transaction];
      const bValue = b[sortConfig.key as keyof Transaction];

      if (aValue === undefined || aValue === null) return 1;
      if (bValue === undefined || bValue === null) return -1;

      let comparison = 0;
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else if (aValue instanceof Date && bValue instanceof Date) {
        comparison = aValue.getTime() - bValue.getTime();
      } else {
        comparison = String(aValue).localeCompare(String(bValue));
      }

      return sortConfig.direction === 'ascending' ? comparison : -comparison;
    });

    return sortableItems
      .filter(t => {
        // Adicionando +1 dia ao final para incluir o dia inteiro
        const transactionDate = new Date(t.Data).setHours(0, 0, 0, 0);
        const startDate = transactionFilters.startDate ? new Date(transactionFilters.startDate).getTime() : null;
        const endDate = transactionFilters.endDate ? new Date(new Date(transactionFilters.endDate).setDate(new Date(transactionFilters.endDate).getDate() + 1)).getTime() : null;

        const matchesText = transactionFilters.text === '' ||
          t.Nome_Fantasia.toLowerCase().includes(transactionFilters.text.toLowerCase()) ||
          t.Valor.toString().includes(transactionFilters.text) ||
          t.Valor.toFixed(2).includes(transactionFilters.text) ||
          t.Valor.toString().replace('.', ',').includes(transactionFilters.text) ||
          t.Valor.toFixed(2).replace('.', ',').includes(transactionFilters.text); // Busca por valor (ponto, vírgula, com/sem decimais)

        return (
          matchesText &&
          (!startDate || transactionDate >= startDate) &&
          (!endDate || transactionDate < endDate) &&
          (transactionFilters.category.length === 0 || transactionFilters.category.includes(t.Categoria)) &&
          (transactionFilters.accountId.length === 0 || (t.ID_Conta && transactionFilters.accountId.includes(t.ID_Conta))) && // Filtro de Conta
          (transactionFilters.type === '' || t.Tipo === transactionFilters.type)
        );
      });
  }, [transactions, transactionFilters, sortConfig]);

  const paginatedTransactions = useMemo(() => {
    if (itemsPerPage === -1) return filteredTransactions; // -1 para "Todos"
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredTransactions.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTransactions, currentPage, itemsPerPage]);

  const totalPages = useMemo(() => {
    if (itemsPerPage === -1) return 1;
    const total = Math.ceil(filteredTransactions.length / itemsPerPage);
    return total > 0 ? total : 1; // Garante que seja no mínimo 1
  }, [filteredTransactions.length, itemsPerPage]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setTransactionFilters({ ...transactionFilters, [e.target.name]: e.target.value });
    setCurrentPage(1); // Reseta para a primeira página ao mudar o filtro
  };

  const handleCategoryFilterChange = (selectedCategories: string[]) => {
    setTransactionFilters({ ...transactionFilters, category: selectedCategories });
    setCurrentPage(1);
  };

  const handleItemsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setItemsPerPage(Number(e.target.value));
    setCurrentPage(1); // Reset to first page
  };

  const handleAccountFilterChange = (selectedAccounts: string[]) => {
    setTransactionFilters({ ...transactionFilters, accountId: selectedAccounts });
    setCurrentPage(1);
  };

  const handleSaveCategory = async (categoryData: Omit<Category, 'id'>) => {
    const result = await addCategory(categoryData);
    if (result.status === 'created') {
      // Find the newly created category ID (or just use the name as we know it)
      setLastCreatedCategory(categoryData.Nome_Categoria);
      setCategoryModalOpen(false);
      await appAlert(result.message, 'Sucesso', 'success');
    } else {
      await appAlert(result.message, 'Sucesso', 'success');
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
        await appAlert(`Conta "${newAccount.Nome_Conta}" criada com sucesso!`, 'Sucesso', 'success');
      }
    }
  };

  const clearFilters = () => {
    setTransactionFilters({
      text: '',
      startDate: '',
      endDate: '',
      category: [],
      type: '',
      accountId: [],
    });
    setCurrentPage(1); // Reseta também ao limpar os filtros
  };

  const handleNewSave = async (newTransactions: Omit<Transaction, 'ID_Transacao' | 'Origem'>[]) => {
    // Loop para salvar múltiplas transações (caso de recorrência/parcelamento)
    // Usamos Promise.all para desempenho
    await Promise.all(newTransactions.map(t => {
      const transactionToSave: Omit<Transaction, 'ID_Transacao'> = {
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
        Origem: 'manual',
        Descricao_Original: t.Nome_Fantasia,
      };
      return addTransaction(transactionToSave);
    }));

    setNewTransactionModalOpen(false);
  }

  const openNewMappingRuleModal = (transaction: Transaction) => {
    // Apenas transações importadas podem gerar regras
    if (transaction.Origem !== 'manual') {
      setTransactionForRule(transaction);
      setMappingRuleModalOpen(true);
    }
  };

  const handleSaveMappingRule = (ruleData: Omit<MappingRule, 'id'>) => {
    addMappingRule(ruleData);
    setMappingRuleModalOpen(false);
    setTransactionForRule(null);
  };

  const requestSort = useCallback((key: keyof Transaction) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  }, [sortConfig]);

  const getSortIndicator = (key: string) => sortConfig.key === key ? (sortConfig.direction === 'ascending' ? ' ▲' : ' ▼') : null;

  const getValueColor = (value: number) => {
    if (value < 0) return 'text-danger';
    if (value > 0) return 'text-accent';
    return 'text-light';
  }

  const handleInlineUpdate = <K extends keyof Transaction>(
    transaction: Transaction,
    field: K,
    value: Transaction[K]
  ) => {
    // SOLUÇÃO FINAL:
    // Criamos um objeto que corresponde exatamente à assinatura da função no store:
    // um objeto que tem o ID_Transacao obrigatório e as outras propriedades atualizadas.
    const updatedTransaction = { ...transaction, [field]: value, ID_Transacao: transaction.ID_Transacao };
    updateTransaction(updatedTransaction);
  };

  // Campos que não podem ser editados em transações importadas
  const nonEditableImportedFields: (keyof Transaction)[] = ['Data', 'Valor', 'Parcela_Atual', 'Total_Parcelas', 'ID_Conta'];

  const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  const formatDate = (date: Date | undefined) => date ? new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';

  const categoryTypeMap = useMemo(() =>
    new Map(categories.map(c => [c.Nome_Categoria, c.Tipo]))
    , [categories]);

  const categoryTypeColorMap: Record<Category['Tipo'], string> = { Renda: 'text-accent', Despesa: 'text-danger', Ambos: 'text-highlight' };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold text-light">Transações</h1>
          <TourButton currentView="transactions" />
        </div>
        <div id="transactions-actions" className="flex gap-2 w-full sm:w-auto">
          <div className="w-40">
            <Select value="" onChange={handleExportChange}>
              <option value="" disabled>Exportar...</option>
              <option value="csv">CSV</option>
              <option value="excel">Excel</option>
            </Select>
          </div>
          <Button onClick={() => setNewTransactionModalOpen(true)}>
            Adicionar Lançamento
          </Button>
        </div>
      </div>

      {accountsWithMissingBank.length > 0 && (
        <div className="bg-gradient-to-r from-highlight/20 to-accent/10 border border-highlight/30 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-highlight/20 p-2 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-highlight" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Identifique seus bancos</p>
              <p className="text-xs text-gray-400">Personalize seus cards com os logos oficiais para uma visualização mais rápida.</p>
            </div>
          </div>
          <button 
            onClick={() => {
              const firstAccount = accountsWithMissingBank[0];
              setEditingTransaction(null);
              setEditingAccount(firstAccount);
              setAccountModalOpen(true);
            }}
            className="px-4 py-1.5 bg-highlight hover:bg-highlight/80 text-white text-xs font-bold rounded-lg transition-all"
          >
            Configurar Agora
          </button>
        </div>
      )}

      <div id="transactions-filters">
        <Card title="Filtros" className="!overflow-visible z-40 relative">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 items-end">
            <Input label="Buscar por descrição ou valor" name="text" value={transactionFilters.text} onChange={handleFilterChange} placeholder="Ex: iFood, 50.00..." className="xl:col-span-2" />
            <Input label="Data de Início" type="date" name="startDate" value={transactionFilters.startDate} onChange={handleFilterChange} />
            <Input label="Data de Fim" type="date" name="endDate" value={transactionFilters.endDate} onChange={handleFilterChange} />
            <div className="xl:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <MultiSelect
                label="Conta"
                options={accounts.map(a => ({ label: a.is_archived ? `${a.Nome_Conta} (Arquivada)` : a.Nome_Conta, value: a.id }))}
                value={transactionFilters.accountId}
                onChange={handleAccountFilterChange}
                placeholder="Todas"
              />
              <MultiSelect
                label="Categoria"
                options={[
                  { label: 'Sem Categoria (-)', value: '-' },
                  ...categories.map(c => ({ label: c.Nome_Categoria, value: c.Nome_Categoria }))
                ]}
                value={transactionFilters.category}
                onChange={handleCategoryFilterChange}
                placeholder="Todas"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:col-span-2">
              <Select label="Tipo" name="type" value={transactionFilters.type} onChange={handleFilterChange}>
                <option value="">Todos</option>
                <option value="Renda">Entrada</option>
                <option value="Despesa">Saída</option>
              </Select>
              <div className="flex items-end">
                <Button variant="secondary" onClick={clearFilters} className="w-full">Limpar Filtros</Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div id="transactions-balances" className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {getAccountsWithCalculatedBalance().filter(a => !a.is_archived).map(account => {
          const currentBalance = account.Saldo_Atual_Calculado ?? 0;
          const bankConfig = NATIVE_BANK_CONFIGS.find(b => b.id === account.bank_id);
          const isCreditCard = account.Tipo_Conta === 'Cartão de Crédito';

          const getIsoDate = (date: Date | string) => {
            if (!date) return '';
            const d = new Date(date);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          };

          const now = new Date();
          const todayStr = getIsoDate(now);

          let faturaAtual = 0;
          let totalUsedLimit = 0;
          let diaFecha = 0;
          let diaVence = 0;
          let diasParaFechar = 0;
          let diasParaVencer = 0;

          if (isCreditCard) {
            const hoje = now.getDate();
            const mesAtual = now.getMonth();
            const anoAtual = now.getFullYear();

            diaFecha = account.dia_fechamento || 0;
            diaVence = account.dia_vencimento || 0;

            // --- LÓGICA DE FATURA INTELIGENTE ---
            // --- LÓGICA DE FATURA BANCÁRIA REAL ---
            const getInvoiceData = (targetMonthOffset: number) => {
              const startDate = new Date(anoAtual, mesAtual + targetMonthOffset - 1, diaFecha || 1);
              const endDate = new Date(anoAtual, mesAtual + targetMonthOffset, diaFecha || 1);
              const startDateStr = getIsoDate(startDate);
              const endDateStr = getIsoDate(endDate);

              // 1. Despesas: Apenas o que foi gasto DENTRO do período do ciclo
              const expenses = transactions
                .filter(t => t.ID_Conta === account.id && t.Tipo === 'Despesa')
                .filter(t => {
                  const d = getIsoDate(t.Data);
                  return d >= startDateStr && d < endDateStr;
                })
                .reduce((acc, t) => acc + Math.abs(t.Valor), 0);
              
              // 2. Pagamentos: Apenas pagamentos feitos APÓS o fechamento desta fatura
              // Um pagamento feito no dia 10/04 paga a fatura de Março, não a de Abril.
              const payments = transactions
                .filter(t => t.ID_Conta === account.id && t.Tipo === 'Renda')
                .filter(t => {
                  const d = getIsoDate(t.Data);
                  return d >= endDateStr && d <= todayStr;
                })
                .reduce((acc, t) => acc + t.Valor, 0);

              const balance = Math.max(0, Math.round((expenses - payments) * 100) / 100);
              
              const dueDate = new Date(endDate.getFullYear(), endDate.getMonth(), diaVence || diaFecha || 1);
              if (diaVence < (diaFecha || 1)) dueDate.setMonth(dueDate.getMonth() + 1);
              
              return { balance, dueDate };
            };

            const currentInvoice = getInvoiceData(0);
            const nextInvoice = getInvoiceData(1);

            if (currentInvoice.balance > 0.01) {
              faturaAtual = currentInvoice.balance;
              diasParaVencer = Math.ceil((currentInvoice.dueDate.getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
            } else {
              faturaAtual = nextInvoice.balance;
              diasParaVencer = Math.ceil((nextInvoice.dueDate.getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
            }

            // 3. Limite Utilizado TOTAL (Dívida total = Saldo Inicial + TODAS as transações sem filtro de data futura)
            // Isso é o que realmente consome o limite (inclusive parcelas futuras)
            const allAccountTransactions = transactions.filter(t => t.ID_Conta === account.id);
            const totalIncome = allAccountTransactions.filter(t => t.Tipo === 'Renda').reduce((acc, t) => acc + t.Valor, 0);
            const totalExpense = allAccountTransactions.filter(t => t.Tipo === 'Despesa').reduce((acc, t) => acc + Math.abs(t.Valor), 0);
            const totalDebt = account.Saldo_Inicial + totalIncome - totalExpense;
            
            totalUsedLimit = Math.abs(Math.min(totalDebt, 0));

            // Dias até fechar/vencer
            if (diaFecha > 0) {
              let proximoFecha = hoje < diaFecha ? new Date(anoAtual, mesAtual, diaFecha) : new Date(anoAtual, mesAtual + 1, diaFecha);
              diasParaFechar = Math.ceil((proximoFecha.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            }
            if (diaVence > 0) {
              let proximoVence = hoje <= diaVence ? new Date(anoAtual, mesAtual, diaVence) : new Date(anoAtual, mesAtual + 1, diaVence);
              diasParaVencer = Math.ceil((proximoVence.getTime() - new Date().setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
            }
          }

          const limite = account.limite_credito || 0;
          const limiteUsadoPct = limite > 0 ? Math.min((totalUsedLimit / limite) * 100, 100) : 0;
          const limiteDisponivel = limite > 0 ? Math.max(limite - totalUsedLimit, 0) : 0;

          const barColor = limiteUsadoPct > 90 ? 'bg-red-500' : limiteUsadoPct > 70 ? 'bg-amber-500' : 'bg-emerald-500';

          return (
            <div
              key={account.id}
              className={`p-5 rounded-2xl shadow-xl border-l-4 flex flex-col justify-between relative overflow-hidden group cursor-pointer transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] ${
                isCreditCard 
                  ? 'bg-gradient-to-br from-slate-900 to-slate-800 border-indigo-500 shadow-indigo-500/10' 
                  : 'bg-gradient-to-br from-secondary to-slate-800 border-accent shadow-accent/10'
              }`}
              onClick={() => {
                setEditingAccount(account);
                setAccountModalOpen(true);
              }}
              title={`Clique para editar ${account.Nome_Conta}`}
            >
              {/* Decorative background element */}
              <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-[0.03] blur-2xl ${isCreditCard ? 'bg-indigo-400' : 'bg-accent'}`} />
              
              {/* Edit Icon Overlay */}
              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-all duration-300 z-20 translate-x-2 group-hover:translate-x-0">
                <div className="bg-white/10 backdrop-blur-md p-2 rounded-xl border border-white/10 shadow-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </div>
              </div>

              <div className="z-10 h-full flex flex-col justify-between">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-2.5 mb-1">
                    {bankConfig?.logoUrl ? (
                      <div className="w-6 h-6 rounded-lg bg-white/5 p-1 flex items-center justify-center border border-white/5 shadow-inner">
                        <img src={bankConfig.logoUrl} alt={bankConfig.name} className="w-full h-full object-contain" />
                      </div>
                    ) : (
                        <div className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-xs border border-white/5">
                            {isCreditCard ? '💳' : '🏦'}
                        </div>
                    )}
                    <h3 className="text-gray-300 text-sm font-bold uppercase tracking-widest truncate" title={account.Nome_Conta}>{account.Nome_Conta}</h3>
                  </div>
                  <span className="text-[10px] text-gray-500 font-black uppercase tracking-tighter ml-9">{account.Tipo_Conta}</span>
                </div>

                {/* CARTÃO DE CRÉDITO: layout diferenciado */}
                {isCreditCard ? (
                  <div className="mt-5 space-y-4">
                    {limite > 0 ? (
                      <>
                        {/* Barra de uso do limite */}
                        <div>
                          <div className="flex justify-between items-center mb-1.5 px-0.5">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wide font-bold">Uso do Limite</span>
                            <span className={`text-[10px] font-black ${limiteUsadoPct > 90 ? 'text-red-400' : 'text-indigo-300'}`}>
                                {limiteUsadoPct.toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-2 bg-black/40 rounded-full overflow-hidden border border-white/5 shadow-inner">
                            <div
                              className={`h-full rounded-full transition-all duration-1000 ease-out ${barColor} shadow-[0_0_12px_rgba(0,0,0,0.5)] relative`}
                              style={{ width: `${limiteUsadoPct}%` }}
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent opacity-50" />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 pt-1">
                          <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                            <p className="text-[9px] text-gray-500 uppercase font-bold tracking-wider mb-0.5">Disponível</p>
                            <p className="text-base font-black text-emerald-400 leading-none">{formatCurrency(limiteDisponivel)}</p>
                          </div>
                          <div className="bg-white/5 p-2 rounded-xl border border-white/5 flex flex-col justify-between min-h-[54px]">
                            <p className="text-[9px] text-gray-500 uppercase font-bold tracking-wider mb-1 text-right w-full">Fatura Atual</p>
                            <div className="flex flex-col items-end gap-1">
                              <p className="text-[15px] font-black text-rose-400 leading-none">
                                {formatCurrency(faturaAtual)}
                              </p>
                              {faturaAtual > 0 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePayInvoice(account, faturaAtual);
                                  }}
                                  className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[8px] font-black px-1.5 py-0.5 rounded border border-emerald-500/20 transition-all active:scale-95 flex items-center gap-1 shadow-sm"
                                >
                                  PAGAR
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Dias até fechar/vencer */}
                        <div className="flex flex-col gap-1.5 pt-3 border-t border-white/5">
                          {diaFecha > 0 ? (
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="text-amber-400/80 font-medium flex items-center gap-1.5">
                                <span className="text-xs">✂️</span> Fechamento em <b>{diasParaFechar}d</b>
                              </span>
                              <span className="text-gray-600 font-bold">DIA {diaFecha}</span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-600 font-bold uppercase italic">🗓️ Ciclo: Primeiro do mês</span>
                          )}
                          {diaVence > 0 && (
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="text-indigo-400/80 font-medium flex items-center gap-1.5">
                                <span className="text-xs">📅</span> Vencimento em <b>{diasParaVencer}d</b>
                              </span>
                              <span className="text-gray-600 font-bold">DIA {diaVence}</span>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      // Cartão sem limite configurado
                      <div className="mt-2 flex flex-col items-end">
                        <span className="text-2xl font-black text-red-400 tracking-tight">{formatCurrency(faturaAtual)}</span>
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mt-1">Fatura Atual</p>
                        <div className="flex gap-2 w-full mt-4">
                          <button
                            className="flex-1 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                            onClick={e => { e.stopPropagation(); setEditingAccount(account); setAccountModalOpen(true); }}
                          >
                            Configurar Limite
                          </button>
                          {faturaAtual > 0 && (
                            <button
                              className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                              onClick={e => { e.stopPropagation(); handlePayInvoice(account, faturaAtual); }}
                            >
                              Pagar
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  // CONTA CORRENTE / OUTRO: layout original
                  <div className="mt-6 flex flex-col items-end">
                    <span className={`text-2xl font-black tracking-tighter ${currentBalance < 0 ? 'text-danger shadow-danger/10' : currentBalance > 0 ? 'text-accent shadow-accent/10' : 'text-light'}`}>
                      {formatCurrency(currentBalance)}
                    </span>
                    <p className="text-[10px] text-gray-500 uppercase tracking-[0.2em] font-black mt-1">Saldo Líquido</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <PaginationControls
        itemsPerPage={itemsPerPage}
        setItemsPerPage={setItemsPerPage}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        totalPages={totalPages}
        totalRecords={filteredTransactions.length}
      />

      <div id="transactions-cards" className="block lg:hidden space-y-3 mb-6">

        {/* Mobile Sort Controls */}
        <div className="flex justify-between items-center bg-secondary p-3 rounded-lg border border-slate-700/50 mb-4 gap-2">
          <span className="text-sm text-gray-400 font-medium whitespace-nowrap">Ordenar por:</span>
          <div className="flex items-center gap-2 w-full justify-end">
            <select
              value={sortConfig.key}
              onChange={(e) => requestSort(e.target.value as keyof Transaction)}
              className="bg-primary/50 border border-slate-700 rounded text-white text-sm px-3 py-1.5 outline-none focus:border-highlight focus:ring-1 focus:ring-highlight appearance-none pr-8 cursor-pointer max-w-[170px]"
              style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1em' }}
            >
              <option value="Data">Data da Compra</option>
              <option value="Data_Pagamento">Data Pagamento</option>
              <option value="Valor">Valor</option>
              <option value="Nome_Fantasia">Nome/Estabelec.</option>
              <option value="Categoria">Categoria</option>
            </select>
            <button
              onClick={() => setSortConfig(prev => ({ ...prev, direction: prev.direction === 'ascending' ? 'descending' : 'ascending' }))}
              className="p-1.5 bg-primary/50 border border-slate-700 rounded text-gray-400 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transform transition-transform ${sortConfig.direction === 'descending' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
            </button>
          </div>
        </div>

        {paginatedTransactions.map(t => (
          <SwipeableItem
            key={t.ID_Transacao}
            className="rounded-xl shadow-md border border-slate-700/50 bg-[#1e293b]" // The background beneath the swipe uses a neutral dark slate color to blend since both sides have different actions
            leftActions={[
              {
                label: 'Editar',
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                ),
                colorClass: 'bg-highlight',
                onClick: () => {
                  setEditingTransaction(t);
                  setNewTransactionModalOpen(true);
                }
              }
            ]}
            rightActions={[
              {
                label: 'Excluir',
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                ),
                colorClass: 'bg-red-500',
                onClick: async () => {
                  if (t.Origem === 'manual') {
                    if (await appConfirm('Excluir este lançamento manual?', 'Excluir Transação', 'Excluir', 'danger')) deleteTransaction(t.ID_Transacao);
                  } else {
                    const batchCount = transactions.filter(tx => tx.Origem === t.Origem).length;
                    setDeleteConfirmation({ transactionId: t.ID_Transacao, origin: t.Origem, count: batchCount });
                  }
                }
              }
            ]}
          >
            <div className="bg-secondary p-4 flex flex-col gap-3 relative overflow-hidden h-full">
              {/* Category Sidebar Accent */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${t.Tipo === 'Renda' ? 'bg-accent' : t.Tipo === 'Despesa' ? 'bg-danger' : 'bg-highlight'}`}></div>

              <div className="flex justify-between items-start pl-2 pr-6">
                <div className="flex flex-col gap-1 overflow-hidden pr-2">
                  <span className="font-semibold text-white truncate text-base leading-tight">
                    {t.Nome_Fantasia || t.Descricao || "Sem Nome"}
                  </span>
                  <span className="text-xs text-gray-400 truncate flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A1 1 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                    {t.Categoria}
                  </span>
                  <span className="text-xs text-gray-500 truncate flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                    {accountsMap.get(t.ID_Conta) || 'Conta Desconhecida'}
                  </span>
                </div>

                <div className="flex flex-col items-end z-10 shrink-0">
                  <span className={`font-bold text-lg leading-none ${getValueColor(t.Valor)}`}>
                    {formatCurrency(t.Valor)}
                  </span>
                  <div className="flex flex-col items-end gap-0.5 mt-1">
                    <span className="text-[9px] text-gray-500 uppercase font-medium tracking-wide">
                      Compra: {t.Data ? t.Data.split('T')[0].split('-').reverse().join('/') : '-'}
                    </span>
                    <span className="text-[9px] text-gray-500 uppercase font-medium tracking-wide">
                      Pgto: {t.Data_Pagamento ? t.Data_Pagamento.split('T')[0].split('-').reverse().join('/') : '-'}
                    </span>
                  </div>
                  {t.Total_Parcelas && t.Total_Parcelas > 1 && (
                    <span className="text-[9px] bg-slate-800 text-highlight px-1.5 py-0.5 rounded-full mt-1 border border-highlight/30">
                      {t.Parcela_Atual || 1}/{t.Total_Parcelas}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </SwipeableItem>
        ))}
        {isLoading && (
          <div className="flex flex-col gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}
        {!isLoading && paginatedTransactions.length === 0 && (
          <div className="bg-secondary p-8 rounded-xl text-center border border-slate-700/50">
            <p className="text-gray-400">Nenhuma transação encontrada.</p>
          </div>
        )}
      </div>

      <div id="transactions-table" className="hidden lg:block bg-secondary rounded-lg shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[800px] sm:min-w-full divide-y divide-primary table-fixed">
            <thead className="bg-slate-700">
              <tr>{[
                { key: 'Data', label: 'Data', width: 'w-24' },
                { key: 'Data_Pagamento', label: 'Pagamento', width: 'w-24' },
                { key: 'ID_Conta', label: 'Conta', width: 'w-28' },
                { key: 'Nome_Fantasia', label: 'Descrição', width: 'w-auto' },
                { key: 'Parcelas', label: 'Parc.', align: 'center', width: 'w-16' },
                { key: 'Categoria', label: 'Categoria', width: 'w-28' },
                { key: 'linked_asset_id', label: 'Vínculo', width: 'w-28' },
                { key: 'Valor', label: 'Valor', align: 'right', width: 'w-28' },
                { key: 'Acoes', label: 'Ações', align: 'right', width: 'w-20' },
              ].map(({ key, label, align, width }) => (
                <th key={key} scope="col" className={`px-2 py-3 text-${align || 'left'} text-xs font-medium text-gray-300 uppercase tracking-wider ${width}`}>
                  {key !== 'Acoes' && key !== 'Parcelas' && key !== 'ID_Conta' ? <button className={`w-full h-full flex items-center ${align === 'right' ? 'justify-end' : 'justify-start'}`} onClick={() => requestSort(key as keyof Transaction)}>
                    {label}{getSortIndicator(key)}
                  </button> : <span className={`flex ${align === 'right' ? 'justify-end' : (align === 'center' ? 'justify-center' : 'justify-start')}`}>{label}</span>}
                </th>
              ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-primary relative">
              {paginatedTransactions.map(t => (
                <tr key={t.ID_Transacao} className="hover:bg-primary">
                  <EditableCell key={`${t.ID_Transacao}-Data-${t.Data}`} transaction={t} field="Data" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} type="date" className="w-24 text-xs" />
                  <EditableCell key={`${t.ID_Transacao}-Data_Pagamento-${t.Data_Pagamento}`} transaction={t} field="Data_Pagamento" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} type="date" className="w-24 text-xs" />
                  <EditableCell key={`${t.ID_Transacao}-ID_Conta-${t.ID_Conta}`} transaction={t} field="ID_Conta" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} type="select" options={accounts.filter(a => !a.is_archived || a.id === t.ID_Conta).map(a => a.id)} displayMap={accountsMap} className="w-28 text-xs truncate" />
                  <EditableCell key={`${t.ID_Transacao}-Nome_Fantasia-${t.Nome_Fantasia}`} transaction={t} field="Nome_Fantasia" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} className="w-auto text-sm" onRuleCreation={openNewMappingRuleModal} />
                  <EditableCell key={`${t.ID_Transacao}-Parcela_Atual-${t.Parcela_Atual}`} transaction={t} field="Parcela_Atual" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} type="installments" className="w-16 text-center text-xs" />
                  <EditableCell 
                    key={`${t.ID_Transacao}-Categoria-${t.Categoria}`} 
                    transaction={t} 
                    field="Categoria" 
                    onUpdate={handleInlineUpdate} 
                    nonEditableFields={nonEditableImportedFields} 
                    type="select" 
                    options={categories.filter(c => c.Tipo === 'Ambos' || c.Tipo === t.Tipo).map(c => c.Nome_Categoria).sort()} 
                    onOpenCreateCategory={() => setCategoryModalOpen(true)}
                    className="w-28 text-xs truncate" 
                  />
                  <EditableCell 
                        key={`${t.ID_Transacao}-linked_asset_id-${t.linked_asset_id}`} 
                        transaction={t} 
                        field="linked_asset_id" 
                        onUpdate={handleInlineUpdate} 
                        nonEditableFields={[]} 
                        type="select" 
                        options={assets.filter(a => a.is_financed).map(a => a.id)} 
                        displayMap={new Map(assets.map(a => [a.id, a.name] as [string, string]))}
                        className="w-28 text-[10px] truncate" 
                  />
                  <EditableCell key={`${t.ID_Transacao}-Valor-${t.Valor}`} transaction={t} field="Valor" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} type="number" className="w-28 text-sm" />
                  <td className="px-2 py-4 whitespace-nowrap text-right text-sm font-medium w-20">
                    <div className="flex items-center justify-end gap-2">
                      {t.Origem === 'manual' && (
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setEditingTransaction(t);
                              setNewTransactionModalOpen(true);
                            }} 
                            className="text-accent hover:text-sky-400"
                            title="Editar Transação"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button 
                            onClick={async () => { if (await appConfirm('Tem certeza que deseja excluir este lançamento manual?', 'Excluir Transação', 'Excluir', 'danger')) deleteTransaction(t.ID_Transacao) }} 
                            className="text-danger hover:text-red-400"
                            title="Excluir Transação"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                      {t.Origem !== 'manual' && (
                        <button
                          onClick={() => {
                            const batchCount = transactions.filter(tx => tx.Origem === t.Origem).length;
                            setDeleteConfirmation({ transactionId: t.ID_Transacao, origin: t.Origem, count: batchCount });
                          }}
                          className="text-gray-500 hover:text-red-400"
                          title={`Excluir lote de importação: ${t.Origem}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isLoading && (
            <div className="absolute inset-0 bg-primary/80 backdrop-blur-sm flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-slate-700 border-t-highlight rounded-full animate-spin"></div>
                <p className="text-sm text-highlight font-medium tracking-widest uppercase">Carregando...</p>
              </div>
            </div>
          )}
          {!isLoading && paginatedTransactions.length === 0 && (
            <p className="text-center text-gray-400 py-8">Nenhuma transação encontrada.</p>
          )}
        </div>
      </div>

      <div className="bg-slate-800 p-4 rounded-lg shadow-inner mb-4 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm border border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 uppercase tracking-wider font-semibold text-xs">Calculadora da Página</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-500 text-xs">Somando {paginatedTransactions.length} itens visíveis</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase">Entradas</p>
            <p className="text-accent font-bold">
              {formatCurrency(paginatedTransactions.reduce((acc, t) => acc + (t.Valor > 0 ? t.Valor : 0), 0))}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase">Saídas</p>
            <p className="text-danger font-bold">
              {formatCurrency(Math.abs(paginatedTransactions.reduce((acc, t) => acc + (t.Valor < 0 ? t.Valor : 0), 0)))}
            </p>
          </div>
          <div className="h-8 w-px bg-slate-600 mx-2"></div>
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase">Líquido (Sobra)</p>
            <p className={`font-bold text-lg ${getValueColor(paginatedTransactions.reduce((acc, t) => acc + t.Valor, 0))}`}>
              {formatCurrency(paginatedTransactions.reduce((acc, t) => acc + t.Valor, 0))}
            </p>
          </div>
        </div>
      </div>

      <PaginationControls
        itemsPerPage={itemsPerPage}
        setItemsPerPage={setItemsPerPage}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        totalPages={totalPages}
        totalRecords={filteredTransactions.length}
      />

      {isNewTransactionModalOpen && (
        <NewTransactionModal
          onClose={() => {
            setNewTransactionModalOpen(false);
            setEditingTransaction(null);
            setPredefinedTransaction(null);
          }}
          onSave={async (newTransactions) => {
            if (editingTransaction) {
              // It's an update. We expect only one item in data[0]
              await updateTransaction({ ID_Transacao: editingTransaction.ID_Transacao, ...newTransactions[0] });
            } else {
              // It's a new transaction (or batch)
              await handleNewSave(newTransactions);
            }
            setNewTransactionModalOpen(false);
            setEditingTransaction(null);
            setPredefinedTransaction(null);
          }}
          accounts={accounts.filter(a => !a.is_archived)}
          categories={categories}
          assets={assets}
          onOpenCreateAccount={() => setAccountModalOpen(true)}
          onOpenCreateCategory={() => setCategoryModalOpen(true)}
          lastCreatedAccount={lastCreatedAccount}
          lastCreatedCategory={lastCreatedCategory}
          transaction={predefinedTransaction || editingTransaction}
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

      {deleteConfirmation && (
        <Modal
          isOpen={true}
          onClose={() => setDeleteConfirmation(null)}
          title="Confirmar Exclusão"
          className="max-w-lg"
        >
          <div className="space-y-4">
            <p className="text-gray-300">Você está tentando excluir uma transação que faz parte de um lote importado. O que você gostaria de fazer?</p>
            <div className="flex flex-col space-y-2">
              <Button variant="secondary" onClick={() => { deleteTransaction(deleteConfirmation.transactionId); setDeleteConfirmation(null); }}>
                Excluir Apenas Esta Transação
              </Button>
              <Button variant="danger" onClick={() => { deleteTransactionsByOrigin(deleteConfirmation.origin); setDeleteConfirmation(null); }}>
                Excluir o Lote Inteiro ({deleteConfirmation.count} transações de "{deleteConfirmation.origin}")
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {isMappingRuleModalOpen && transactionForRule && (
        <MappingRuleModal
          transaction={transactionForRule}
          categories={categories}
          assets={assets}
          onClose={() => { setMappingRuleModalOpen(false); setTransactionForRule(null); }}
          onSave={handleSaveMappingRule}
        />
      )}

      {/* Mobile Floating Action Button (FAB) relative to the screen */}
      <button
        onClick={() => {
          setEditingTransaction(null);
          setPredefinedTransaction(null);
          setNewTransactionModalOpen(true);
        }}
        className="fixed lg:hidden bottom-24 landscape:max-lg:bottom-10 right-6 sm:right-10 w-14 h-14 bg-highlight hover:bg-sky-400 text-white rounded-full shadow-[0_4px_14px_rgba(56,189,248,0.5)] flex items-center justify-center transition-transform active:scale-95 z-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-primary focus:ring-highlight"
        aria-label="Nova Transação"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
};

// Componente para Célula Editável
interface EditableCellProps {
  transaction: Transaction;
  field: keyof Transaction;
  onUpdate: (transaction: Transaction, field: keyof Transaction, value: any) => void;
  nonEditableFields: (keyof Transaction)[];
  type?: 'text' | 'date' | 'select' | 'number' | 'installments';
  options?: string[];
  displayMap?: Map<string, string>; // Mapa para exibir nomes em vez de IDs
  className?: string;
  onRuleCreation?: (transaction: Transaction) => void;
  onOpenCreateCategory?: () => void;
}
const EditableCell: React.FC<EditableCellProps> = ({
  transaction,
  field,
  onUpdate,
  nonEditableFields,
  type = 'text',
  options = [],
  displayMap,
  className = '',
  onRuleCreation,
  onOpenCreateCategory
}) => {
  const { categories } = useAppStore();
  const [isEditing, setIsEditing] = useState(false);
  const initialValue = transaction[field];
  const [value, setValue] = useState(initialValue);

  // Sync local state with prop changes
  useEffect(() => {
    // console.log(`EditableCell useEffect [${field}]:`, transaction[field]);
    setValue(transaction[field]);
  }, [transaction, field]);

  // Regras de edição
  const isEditable = field !== 'Fonte' && (transaction.Origem === 'manual' || !nonEditableFields.includes(field));

  const categoryTypeMap = useMemo(() => new Map(categories.map(c => [c.Nome_Categoria, c.Tipo])), [categories]);
  const categoryTypeColorMap: Record<Category['Tipo'], string> = { Renda: 'text-accent', Despesa: 'text-danger', Ambos: 'text-highlight' };

  const handleSave = () => {
    if (value === initialValue) {
      setIsEditing(false);
      return;
    }

    if (type === 'installments') {
      const parts = (value as string).split('/');
      const current = parseInt(parts[0], 10) || undefined;
      const total = parseInt(parts[1], 10) || undefined;
      if (current !== transaction.Parcela_Atual) onUpdate(transaction, 'Parcela_Atual', current);
      if (total !== transaction.Total_Parcelas) onUpdate(transaction, 'Total_Parcelas', total);
    } else if (type === 'date' && (field === 'Data' || field === 'Data_Pagamento')) {
      const newValue = value ? new Date(value as string) : undefined;
      onUpdate(transaction, field, newValue);
    } else if (type === 'number' && field === 'Valor') {
      const newValue = parseFloat(value as string || '0');
      onUpdate(transaction, field, newValue);
    } else if (field === 'Nome_Fantasia' || field === 'Categoria' || field === 'ID_Conta' || field === 'linked_asset_id') {
      onUpdate(transaction, field, value as string);
    }

    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setValue(initialValue);
      setIsEditing(false);
    }
  };

  const cellContent = () => {
    if (displayMap && value) {
      return displayMap.get(value as string) || String(value);
    }
    if (type === 'date') return new Date(value as Date).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    if (type === 'number') return formatCurrency(value as number);
    if (type === 'installments') return `${transaction.Parcela_Atual || 1}/${transaction.Total_Parcelas || 1}`;
    return String(value || '-');
  };

  const getValueColor = (val: number) => {
    if (val < 0) return 'text-danger';
    if (val > 0) return 'text-accent';
    return 'text-light';
  }

  if (!isEditable) {
    const isValueColumn = field === 'Valor';
    const valueColor = isValueColumn ? getValueColor(transaction.Valor) : (field === 'Parcela_Atual' ? 'text-light' : 'text-gray-400');
    const align = isValueColumn ? 'text-right' : 'text-left';
    // Usa break-word para quebrar entre palavras, não no meio delas.
    const whitespaceClass = (field === 'Nome_Fantasia' || field === 'Categoria') ? 'whitespace-normal break-word' : 'whitespace-nowrap';
    return <td className={`px-2 py-3 text-sm font-semibold border-r border-slate-800 last:border-r-0 ${valueColor} ${align} ${whitespaceClass} ${className}`}>{cellContent()}</td>;
  }

  if (isEditing) {
    if (type === 'select') {
      return (
        <td className="p-0 border-r border-slate-800 last:border-r-0">
          <Select 
            value={value as string} 
            onChange={e => {
              if (e.target.value === 'ADD_NEW_CATEGORY') {
                onOpenCreateCategory?.();
                setIsEditing(false);
              } else {
                setValue(e.target.value);
              }
            }} 
            onBlur={handleSave} 
            onKeyDown={handleKeyDown} 
            autoFocus 
            className="w-full h-full bg-slate-800 border-highlight !rounded-none"
          >
            <option value="">-</option>
            {options
              .filter(opt => opt !== '' && opt !== '-')
              .map(opt => <option key={opt} value={opt}>{displayMap ? displayMap.get(opt) : opt}</option>)
            }
            {field === 'Categoria' && (
              <option value="ADD_NEW_CATEGORY" className="text-highlight font-bold">+ Adicionar Categoria</option>
            )}
          </Select>
        </td>
      );
    }
    // Correção: Garante que 'value' é uma data válida antes de chamar toISOString()
    const dateValue = value ? new Date(value as Date) : null;
    const inputValue = type === 'date' && dateValue && !isNaN(dateValue.getTime()) ? dateValue.toISOString().split('T')[0]
      : type === 'installments' ? `${transaction.Parcela_Atual || ''}/${transaction.Total_Parcelas || ''}`
        : value as string;

    return <td className="p-0 border-r border-slate-800 last:border-r-0"><Input type={type === 'date' ? 'date' : 'text'} value={inputValue} onChange={e => setValue(e.target.value)} onBlur={handleSave} onKeyDown={handleKeyDown} autoFocus className="w-full h-full bg-slate-800 border-highlight !rounded-none text-center" /></td>;
  }

  const categoryColor = field === 'Categoria' && categoryTypeMap.has(value as string) ? categoryTypeColorMap[categoryTypeMap.get(value as string)!] : '';
  const valueColor = field === 'Valor' ? getValueColor(value as number) : '';
  const align = field === 'Valor' ? 'text-right' : (field === 'Parcela_Atual' ? 'text-center' : 'text-left');

  return (
    <td
      className="p-0 cursor-pointer border-r border-slate-800 last:border-r-0"
      onClick={() => setIsEditing(true)}
    >
      <div className={`relative group px-2 py-3 text-sm font-semibold border-b border-dotted ${isEditable ? 'border-slate-600 hover:border-highlight' : 'border-transparent'} ${align} ${categoryColor} ${valueColor} ${className} ${(field === 'Nome_Fantasia' || field === 'Categoria') ? 'whitespace-normal break-word' : 'whitespace-nowrap'}`}>
        <span>{cellContent()}</span>
        {field === 'Nome_Fantasia' && transaction.Origem !== 'manual' && onRuleCreation && (
          <button
            onClick={(e) => { e.stopPropagation(); onRuleCreation(transaction); }}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-full bg-slate-700 text-slate-400 hover:bg-highlight hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
            title="Criar regra de mapeamento"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
              <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
    </td>
  );
};



interface PaginationControlsProps {
  itemsPerPage: number;
  setItemsPerPage: (value: number) => void;
  currentPage: number;
  setCurrentPage: (updater: (prev: number) => number) => void;
  totalPages: number;
  totalRecords: number;
}

const PaginationControls: React.FC<PaginationControlsProps> = ({
  itemsPerPage,
  setItemsPerPage,
  currentPage,
  setCurrentPage,
  totalPages,
  totalRecords,
}) => {
  return (
    <div className="flex flex-col md:flex-row justify-between items-center mt-4 text-sm text-gray-400 px-4 py-3 bg-secondary rounded-lg gap-4">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span>Mostrar</span>
        <select
          value={itemsPerPage}
          onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(p => 1); }}
          className="bg-primary/50 border border-slate-700 rounded text-white px-2 py-1 outline-none focus:border-highlight focus:ring-1 focus:ring-highlight appearance-none pr-8 cursor-pointer"
          style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1em' }}
        >
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
          <option value="500">500</option>
          <option value="1000">1000</option>
          <option value="2000">2000</option>
          <option value="5000">5000</option>
          <option value="10000">10000</option>
          <option value="20000">20000</option>
          <option value="50000">50000</option>
          <option value="100000">100000</option>
          <option value="500000">500000</option>
          <option value="-1">Todos</option>
        </select>
        <span>registros de {totalRecords}</span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <span>Página {currentPage} de {totalPages}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Anterior</Button>
          <Button variant="secondary" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Próximo</Button>
        </div>
      </div>
    </div>
  );
};

export default TransactionsView;
