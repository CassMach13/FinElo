import { create } from 'zustand';
import { appAlert } from './useDialogStore';
import { supabase } from '../supabaseClient';
import { Transaction, Category, Budget, MappingRule, ImportConfig, Account, ImportLog, SupportTicket, Subscription, AdminMetrics, Asset, FamilyMember, AppView } from '../types';
import { User } from '@supabase/supabase-js';


// Interface para o estado da nossa aplicação
interface AppState {
  transactions: Transaction[];
  user: User | null;
  accounts: Account[];
  categories: Category[];
  budgets: Budget[];
  mappingRules: MappingRule[];
  importConfigs: ImportConfig[];
  importLogs: ImportLog[]; // New state
  isLoading: boolean;
  transactionFilters: {
    text: string;
    startDate: string;
    endDate: string;
    category: string[];
    type: string;
    accountId: string[];
  };

  // Assets (Patrimônio)
  assets: Asset[];
  fetchAssets: () => Promise<void>;
  addAsset: (asset: Omit<Asset, 'id' | 'user_id' | 'updated_at'>) => Promise<void>;
  deleteAsset: (assetId: string) => Promise<void>;
  updateAsset: (asset: Partial<Asset> & { id: string }) => Promise<void>;
  recalculateAssetBalance: (assetId: string) => Promise<void>;
  recalculateAllAssetBalances: () => Promise<void>;

  setTransactionFilters: (filters: AppState['transactionFilters']) => void;
  setUser: (user: User | null) => void;
  updateUserPreferences: (preferences: Partial<User['user_metadata']>) => Promise<void>;
  signOut: () => Promise<void>;

  // Novas ações para buscar dados do Supabase
  fetchAllData: () => Promise<void>;
  fetchTransactions: () => Promise<void>;

  // CRUD for Accounts
  fetchAccounts: () => Promise<void>;
  addAccount: (account: Omit<Account, 'id' | 'user_id'>) => Promise<Account | null>;
  updateAccount: (account: Partial<Account> & { id: string }) => Promise<void>;
  deleteAccount: (accountId: string) => Promise<void>;
  archiveAccount: (accountId: string, isArchived: boolean) => Promise<void>;
  getAccountsWithCalculatedBalance: () => Account[];

  // Funções para manipular o estado (ações)
  addTransaction: (transaction: Omit<Transaction, 'ID_Transacao' | 'Origem'> | Omit<Transaction, 'ID_Transacao' | 'Origem'>[]) => Promise<void>;
  addMultipleTransactions: (newTransactions: Omit<Transaction, 'ID_Transacao' | 'user_id'>[], importConfig: ImportConfig, fileName: string, ignoredItems?: any[]) => Promise<{ imported: number, ignored: number }>;
  updateTransaction: (updatedTransaction: Partial<Transaction> & { ID_Transacao: string }) => Promise<void>;
  deleteTransaction: (transactionId: string) => Promise<void>;
  deleteTransactionsByOrigin: (origin: string) => Promise<void>;

  // CRUD for Categories
  fetchCategories: () => Promise<void>;
  addCategory: (category: Omit<Category, 'id' | 'user_id'>) => Promise<{ status: 'created' | 'updated' | 'duplicate' | 'error', message: string }>;
  updateCategory: (category: Category) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;
  getSortedCategories: () => Category[];

  // CRUD for Budgets
  fetchBudgets: () => Promise<void>;
  addBudget: (budget: Omit<Budget, 'id' | 'user_id'>) => Promise<void>;
  updateBudget: (budget: Budget) => Promise<void>;
  deleteBudget: (budgetId: string) => Promise<void>;

  // CRUD for Mapping Rules
  fetchMappingRules: () => Promise<void>;
  addMappingRule: (rule: Omit<MappingRule, 'id' | 'user_id'>) => Promise<void>;
  updateMappingRule: (rule: MappingRule) => Promise<void>;
  deleteMappingRule: (ruleId: string) => Promise<void>;
  applyRuleToExistingTransactions: (rule: MappingRule) => Promise<void>;
  reApplyAllRules: () => Promise<void>;
  findDuplicateRules: () => MappingRule[][];

  // CRUD for Import Configs
  fetchImportConfigs: () => Promise<void>;
  addImportConfig: (config: Omit<ImportConfig, 'id' | 'user_id'>) => Promise<void>;
  updateImportConfig: (config: ImportConfig) => Promise<void>;
  deleteImportConfig: (configId: string) => Promise<void>;

  // Import Logs
  fetchImportLogs: () => Promise<void>;
  deleteImportLog: (logId: string, fileName: string) => Promise<void>;
  syncLegacyImportLogs: () => Promise<void>;

  // Support Tickets
  supportTickets: SupportTicket[];
  fetchSupportTickets: () => Promise<void>; // Fetch own tickets
  fetchAllTickets: () => Promise<void>; // Admin: Fetch all tickets
  createSupportTicket: (ticket: Omit<SupportTicket, 'id' | 'user_id' | 'status' | 'created_at' | 'updated_at'>, file?: File) => Promise<void>;
  updateSupportTicketStatus: (ticketId: string, status: SupportTicket['status']) => Promise<void>;

  // Subscription
  subscription: Subscription | null;
  fetchSubscription: () => Promise<void>;
  isPremium: boolean; // Helper computed property
  isWealth: boolean; // Helper computed property for Wealth tier
  unlimitedSync: boolean; // NEW: Premium VIP sync bypass
  respondToTicket?: (ticketId: string) => Promise<void>; // Deprecated
  sendMessage: (ticketId: string, message: string, file?: File) => Promise<void>;
  uploadTicketAttachment: (file: File) => Promise<string | null>;

  // Admin Dashboard
  adminMetrics: AdminMetrics | null;
  fetchAdminMetrics: () => Promise<void>;

  // Navigation & UI State
  currentView: AppView;
  setCurrentView: (view: AppView) => void;

  // Family Plan Acceptance
  pendingInvites: FamilyMember[];
  fetchPendingInvites: () => Promise<void>;
  respondToInvite: (inviteId: string, status: 'accepted' | 'declined') => Promise<void>;

  // Founder's Pack Counter
  founderCount: number;
  fetchFounderCount: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ... existing code ...

  // --- ESTADO INICIAL ---
  transactions: [],
  user: null,
  accounts: [],
  categories: [],
  budgets: [],
  mappingRules: [],
  importConfigs: [],
  importLogs: [],
  supportTickets: [],
  subscription: null,
  isPremium: false,
  isWealth: false,
  unlimitedSync: false,
  isLoading: false,
  adminMetrics: null,
  assets: [],
  transactionFilters: {
    text: '',
    startDate: '',
    endDate: '',
    category: [],
    type: '',
    accountId: [],
  },
  currentView: 'dashboard',
  setCurrentView: (view) => set({ currentView: view }),
  pendingInvites: [],
  founderCount: 0,

  // --- AÇÕES ---

  // Filtros de Transação
  setTransactionFilters: (filters) => set({ transactionFilters: filters }),
  setUser: (user) => {
    const isAdmin = user?.email?.toLowerCase().trim() === 'cassiomq@gmail.com';
    set({ 
      user, 
      isPremium: isAdmin || get().isPremium, 
      isWealth: isAdmin || get().isWealth,
      unlimitedSync: isAdmin || get().unlimitedSync 
    });
  },
  
  updateUserPreferences: async (preferences) => {
    const { user } = get();
    if (!user) return;
    
    // Update local state optimistically
    const updatedUser = {
      ...user,
      user_metadata: {
        ...user.user_metadata,
        ...preferences
      }
    };
    get().setUser(updatedUser as User);

    // Persist to Supabase Auth
    const { error } = await supabase.auth.updateUser({
      data: preferences
    });
    
    if (error) {
      console.error('Error updating user preferences:', error);
      // Optional: rollback state if needed
    }
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Erro ao fazer log-off (mas limpando estado local):', error.message);
    }

    // Limpa o estado da aplicação SEMPRE, independente do erro no servidor
    set({
      user: null,
      transactions: [],
      accounts: [],
      categories: [],
      budgets: [],
      mappingRules: [],
      importConfigs: [],
      importLogs: []
    });
    // O redirecionamento será tratado no componente App.tsx
  },

  fetchAllData: async () => {
    set({ isLoading: true });
    await Promise.all([
      get().fetchTransactions(),
      get().fetchAccounts(),
      get().fetchCategories(),
      get().fetchBudgets(),
      get().fetchMappingRules(),
      get().fetchImportConfigs(),
      get().fetchPendingInvites(),
      get().fetchImportLogs(),
      get().fetchSubscription(),
      get().fetchAssets(),
      get().fetchFounderCount(),
    ]);
    set({ isLoading: false });
  },


  // Transações (agora com Supabase)
  fetchTransactions: async () => {
    set({ isLoading: true });
    let allTransactions: Transaction[] = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .range(from, to);

      if (error) {
        console.error('Erro ao buscar transações (página ' + page + '):', error);
        hasMore = false; // Stop on error
      } else {
        if (data) {
          allTransactions = [...allTransactions, ...data as Transaction[]];
          // If we got fewer items than requested, we've reached the end
          if (data.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }
    }

    set({ transactions: allTransactions, isLoading: false });
  },

  // Contas
  fetchAccounts: async () => {
    const { data, error } = await supabase.from('contas').select('*');
    if (error) {
      console.error('Erro ao buscar contas:', error);
    } else {
      set({ accounts: data as Account[] });
    }
  },
  addAccount: async (account) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    console.log('%c[Store: addAccount] 1. Dados recebidos para nova conta:', 'color: #9933ff', account);

    const { data, error } = await supabase.from('contas').insert([{ ...account, user_id: user.id }]).select();

    if (error) {
      console.error('%c[Store: addAccount] 2. Erro do Supabase ao adicionar conta:', 'color: #ff3333', error);
      return null;
    } else if (data) {
      console.log('%c[Store: addAccount] 2. Sucesso! Resposta do Supabase:', 'color: #33cc33', data[0]);
      const newAccount = data[0] as Account;
      set((state) => {
        const newState = { accounts: [...state.accounts, newAccount] };
        console.log('%c[Store: addAccount] 3. Estado atualizado. Novo array de contas:', 'color: #3399ff', newState.accounts);
        return newState;
      });
      return newAccount;
    } else {
      console.warn('%c[Store: addAccount] 2. Supabase não retornou nem erro, nem dados.', 'color: #ff9933');
      return null;
    }
  },
  updateAccount: async (updatedAccount) => {
    const { id, ...fieldsToUpdate } = updatedAccount;
    // Remove o campo calculado para não tentar salvá-lo no banco
    delete (fieldsToUpdate as Partial<Account>).Saldo_Atual_Calculado;

    console.log('[Store: updateAccount] Iniciando atualização da conta ID:', id);
    console.log('[Store: updateAccount] Campos a serem atualizados:', fieldsToUpdate);

    const { data, error } = await supabase.from('contas').update(fieldsToUpdate).eq('id', id).select();
    
    if (error) {
      console.error('[Store: updateAccount] Erro do Supabase ao atualizar conta:', error);
      console.error('[Store: updateAccount] Detalhes do erro:', error.details, error.hint, error.message);
    } else if (data) {
      console.log('[Store: updateAccount] Sucesso! Conta atualizada:', data[0]);
      set((state) => ({
        accounts: state.accounts.map(a => a.id === id ? data[0] as Account : a)
      }));
    }
  },

  archiveAccount: async (accountId: string, isArchived: boolean) => {
    const { data, error } = await supabase
      .from('contas')
      .update({ is_archived: isArchived })
      .eq('id', accountId)
      .select();

    if (error) {
      console.error('Erro ao arquivar/desarquivar conta:', error);
    } else if (data) {
      set((state) => ({
        accounts: state.accounts.map(a => a.id === accountId ? data[0] as Account : a)
      }));
    }
  },

  deleteAccount: async (accountId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Verificar se existem transações vinculadas
    const { count, error: countError } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('ID_Conta', accountId);
      
    if (countError) {
      console.error('Erro ao verificar transações da conta:', countError);
      return;
    }
    
    if (count && count > 0) {
      // Retorna uma rejeição para a UI capturar e mostrar um alerta
      return Promise.reject(new Error('has_transactions'));
    }

    // 2. Delete the account
    const { error } = await supabase.from('contas').delete().eq('id', accountId);
    if (error) {
      console.error('Erro ao deletar conta:', error);
    } else {
      set((state) => ({
        accounts: state.accounts.filter((a) => a.id !== accountId),
      }));
    }
  },

  getAccountsWithCalculatedBalance: () => {
    const { accounts, transactions } = get();
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    return accounts.map(account => {
      const isCreditCard = account.Tipo_Conta === 'Cartão de Crédito';
      const initialBalanceDate = new Date(account.Data_Saldo_Inicial).getTime();

      const relevantTransactionsSum = transactions
        .filter(t => {
          if (t.ID_Conta !== account.id) return false;
          
          const transactionPurchaseDate = new Date(t.Data).getTime();
          // For credit cards, we care about the PURCHASE date (limit consumption), 
          // and we include ALL transactions (past and future) to reflect total debt.
          if (isCreditCard) {
            return transactionPurchaseDate > initialBalanceDate;
          }

          // For other accounts, we use the Payment Date filter (cash flow view)
          const paymentDateStr = t.Data_Pagamento ? new Date(t.Data_Pagamento).toISOString().split('T')[0] : new Date(t.Data).toISOString().split('T')[0];
          return transactionPurchaseDate > initialBalanceDate && paymentDateStr <= todayStr;
        })
        .reduce((sum, t) => sum + t.Valor, 0);

      return { ...account, Saldo_Atual_Calculado: Math.round((account.Saldo_Inicial + relevantTransactionsSum) * 100) / 100 };
    });
  },

  addTransaction: async (newTransactions) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const transactionsArray = (Array.isArray(newTransactions) ? newTransactions : [newTransactions]) as Omit<Transaction, 'ID_Transacao' | 'Origem'>[];

    const payloads = transactionsArray.map(tx => ({
      user_id: user.id,
      Data: tx.Data,
      Data_Pagamento: tx.Data_Pagamento,
      Nome_Fantasia: tx.Nome_Fantasia,
      Descricao_Original: tx.Descricao_Original || tx.Nome_Fantasia,
      Categoria: tx.Categoria,
      Tipo: tx.Tipo,
      Valor: tx.Valor,
      Parcela_Atual: tx.Parcela_Atual,
      Total_Parcelas: tx.Total_Parcelas,
      Fonte: (tx as any).Fonte || 'Manual',
      Origem: (tx as any).Origem || 'manual',
      ID_Conta: tx.ID_Conta,
      linked_asset_id: tx.linked_asset_id,
    }));

    const { data, error } = await supabase
      .from('transactions')
      .insert(payloads)
      .select();

    if (error) {
      console.error('Erro ao adicionar transação(ões):', error);
      throw error;
    } else if (data) {
      const addedTransactions = data as Transaction[];
      set((state) => ({ transactions: [...state.transactions, ...addedTransactions] }));

      // Automação: Atualizar saldo do patrimônio se houver vínculo
      const affectedAssetIds = new Set(addedTransactions.filter(tx => tx.linked_asset_id).map(tx => tx.linked_asset_id as string));
      for (const assetId of affectedAssetIds) {
        await get().recalculateAssetBalance(assetId);
      }
    }
  },

  addMultipleTransactions: async (newTransactions, importConfig, fileName, ignoredItems = []) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { imported: 0, ignored: 0 };

    const { transactions } = get();

    // 1. Identify duplicates
    const duplicates: any[] = [];
    const toImport: Omit<Transaction, 'ID_Transacao' | 'user_id'>[] = [];

    newTransactions.forEach(newTx => {
      const isDuplicate = transactions.some(existingTx => {
        // Duplicate criteria: Same Date, Value, Original Description, Installment, AND Payment Date
        const getIsoDate = (d: Date | string | undefined | null) => d ? new Date(d).toISOString().split('T')[0] : 'null';

        const sameDate = getIsoDate(existingTx.Data) === getIsoDate(newTx.Data);
        const sameValue = existingTx.Valor === newTx.Valor;
        const sameDesc = (existingTx.Descricao_Original || '').trim() === (newTx.Descricao_Original || '').trim();
        const sameParcela = (existingTx.Parcela_Atual || 1) === (newTx.Parcela_Atual || 1);
        const samePaymentDate = getIsoDate(existingTx.Data_Pagamento) === getIsoDate(newTx.Data_Pagamento);
        // STRICT CHECK: Also compare Account ID to allow same transaction in different accounts
        // If importConfig defines an account, use it. Otherwise check if transaction already has one.
        const targetAccountId = importConfig.ID_Conta_Associada || newTx.ID_Conta;
        const sameAccount = targetAccountId ? existingTx.ID_Conta === targetAccountId : true; // If no account specified, be conservative (match any)

        return sameDate && sameValue && sameDesc && sameParcela && samePaymentDate && sameAccount;
      });



      if (isDuplicate) {
        duplicates.push({
          Data: newTx.Data,
          Valor: newTx.Valor,
          Descricao: newTx.Descricao_Original,
          Motivo: 'Duplicado (detectado na importação)'
        });
      } else {
        toImport.push(newTx);
      }
    });

    // 2. Prepare transactions to insert
    const transactionsWithContext = toImport.map(t => ({
      ...t,
      user_id: user.id,
      ID_Conta: importConfig.ID_Conta_Associada || null,
    }));

    // 3. Insert new transactions
    if (transactionsWithContext.length > 0) {
      const { data, error } = await supabase
        .from('transactions')
        .insert(transactionsWithContext)
        .select();

      if (error) {
        console.error('Erro ao adicionar múltiplas transações:', error);
      } else if (data) {
        const newBatch = data as Transaction[];
        set((state) => ({ transactions: [...state.transactions, ...newBatch] }));

        // Automação: Atualizar saldo do patrimônio para a nova leva se houver vínculo
        const affectedAssetIds = new Set(newBatch.filter(tx => tx.linked_asset_id).map(tx => tx.linked_asset_id as string));
        for (const assetId of affectedAssetIds) {
          await get().recalculateAssetBalance(assetId);
        }
      }
    }

    // 4. Log the import result
    // Combine duplicates found here with ignored items passed from parser
    const allIgnoredDetails = [...duplicates, ...ignoredItems];

    const logEntry = {
      user_id: user.id,
      file_name: fileName,
      total_transactions: newTransactions.length + ignoredItems.length, // Total includes those ignored by parser
      imported_count: transactionsWithContext.length,
      ignored_count: allIgnoredDetails.length,
      ignored_details: allIgnoredDetails,
      imported_details: transactionsWithContext.map(t => ({
        Data: t.Data,
        Descricao: t.Descricao_Original,
        Nome_Fantasia: t.Nome_Fantasia,
        Valor: t.Valor,
        Categoria: t.Categoria
      }))
    };

    const { error: logError } = await supabase.from('import_logs').insert([logEntry]);
    if (logError) console.error('Erro ao salvar log de importação:', logError);
    else get().fetchImportLogs(); // Refresh logs

    return { imported: transactionsWithContext.length, ignored: allIgnoredDetails.length };
  },

  updateTransaction: async (updatedTransaction) => {
    const { ID_Transacao, ...fieldsToUpdate } = updatedTransaction; 
    
    // Pegar o estado anterior para identificar o asset antigo
    const oldTransaction = get().transactions.find(t => t.ID_Transacao === ID_Transacao);
    const oldAssetId = oldTransaction?.linked_asset_id;

    const { data, error } = await supabase
      .from('transactions')
      .update(fieldsToUpdate)
      .eq('ID_Transacao', ID_Transacao)
      .select();

    if (error) {
      console.error('Erro ao atualizar transação:', error);
    } else if (data) {
      const updated = data[0] as Transaction;
      set((state) => ({
        transactions: state.transactions.map(t => t.ID_Transacao === ID_Transacao ? updated : t)
      }));

      // Recalcular saldos se houver vínculo
      if (updated.linked_asset_id) {
        await get().recalculateAssetBalance(updated.linked_asset_id);
      }
      // Se o asset mudou, recalcular o antigo também
      if (oldAssetId && oldAssetId !== updated.linked_asset_id) {
        await get().recalculateAssetBalance(oldAssetId);
      }
    }
  },

  deleteTransaction: async (transactionId) => {
    const transaction = get().transactions.find(t => t.ID_Transacao === transactionId);
    const assetId = transaction?.linked_asset_id;

    const { error } = await supabase.from('transactions').delete().eq('ID_Transacao', transactionId);

    if (error) {
      console.error('Erro ao deletar transação:', error);
    } else {
      set((state) => ({
        transactions: state.transactions.filter(t => t.ID_Transacao !== transactionId)
      }));

      // Recalcular saldo se houver vínculo
      if (assetId) {
        await get().recalculateAssetBalance(assetId);
      }
    }
  },

  deleteTransactionsByOrigin: async (origin) => {
    // Identify affected assets before deletion
    const affectedAssetIds = new Set(
      get().transactions
        .filter(t => t.Origem === origin && t.linked_asset_id)
        .map(t => t.linked_asset_id as string)
    );

    const { error } = await supabase.from('transactions').delete().eq('Origem', origin);
    if (error) {
      console.error('Erro ao deletar lote de transações:', error);
    } else {
      set((state) => ({
        transactions: state.transactions.filter(t => t.Origem !== origin)
      }));

      // Recalcular saldo de todos os ativos afetados
      for (const assetId of affectedAssetIds) {
        await get().recalculateAssetBalance(assetId);
      }
    }
  },

  // Categorias (com Supabase)
  fetchCategories: async () => {
    const { data, error } = await supabase.from('categories').select('*');
    if (error) console.error('Erro ao buscar categorias:', error);
    else set({ categories: data as Category[] });
  },
  addCategory: async (newCategory) => {
    const state = get();
    const categoryName = newCategory.Nome_Categoria.trim();
    if (!categoryName) return { status: 'error', message: 'O nome da categoria não pode estar vazio.' };

    const existingCategory = state.categories.find(c => c.Nome_Categoria.trim().toLowerCase() === categoryName.toLowerCase());
    if (existingCategory) {
      if (existingCategory.Tipo !== newCategory.Tipo && existingCategory.Tipo !== 'Ambos') {
        const updatedCategory = { ...existingCategory, Tipo: 'Ambos' as const };
        await get().updateCategory(updatedCategory);
        return { status: 'updated', message: `Categoria "${existingCategory.Nome_Categoria}" atualizada para o tipo "Ambos".` };
      }
      return { status: 'duplicate', message: `A categoria "${existingCategory.Nome_Categoria}" já existe.` };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: 'error', message: 'Usuário não autenticado.' };

    const { data, error } = await supabase.from('categories').insert([{ ...newCategory, user_id: user.id }]).select();
    if (error) {
      console.error('Erro ao adicionar categoria:', error);
      return { status: 'error', message: error.message };
    }
    if (data) {
      set({ categories: [...state.categories, data[0] as Category] });
    }
    return { status: 'created', message: `Categoria "${categoryName}" criada com sucesso!` };
  },
  updateCategory: async (updatedCategory) => {
    const { id, ...fieldsToUpdate } = updatedCategory;
    const { data, error } = await supabase.from('categories').update(fieldsToUpdate).eq('id', id).select();
    if (error) console.error('Erro ao atualizar categoria:', error);
    else if (data) set((state) => ({ categories: state.categories.map(c => c.id === id ? data[0] as Category : c) }));
  },
  deleteCategory: async (categoryId) => {
    const { error } = await supabase.from('categories').delete().eq('id', categoryId);
    if (error) console.error('Erro ao deletar categoria:', error);
    else set((state) => ({ categories: state.categories.filter(c => c.id !== categoryId) }));
  },
  getSortedCategories: () => {
    const { categories } = get();
    return [...categories].sort((a, b) => a.Nome_Categoria.localeCompare(b.Nome_Categoria, 'pt-BR'));
  },

  // Orçamentos (com Supabase)
  fetchBudgets: async () => {
    const { data, error } = await supabase.from('budgets').select('*');
    if (error) console.error('Erro ao buscar orçamentos:', error);
    else set({ budgets: data as Budget[] });
  },
  addBudget: async (budget) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('budgets').insert([{ ...budget, user_id: user.id }]).select();
    if (error) console.error('Erro ao adicionar orçamento:', error);
    else if (data) set((state) => ({ budgets: [...state.budgets, data[0] as Budget] }));
  },
  updateBudget: async (updatedBudget) => {
    const { id, ...fieldsToUpdate } = updatedBudget;
    const { data, error } = await supabase.from('budgets').update(fieldsToUpdate).eq('id', id).select();
    if (error) console.error('Erro ao atualizar orçamento:', error);
    else if (data) set((state) => ({ budgets: state.budgets.map(b => b.id === id ? data[0] as Budget : b) }));
  },
  deleteBudget: async (budgetId) => {
    const { error } = await supabase.from('budgets').delete().eq('id', budgetId);
    if (error) console.error('Erro ao deletar orçamento:', error);
    else set((state) => ({ budgets: state.budgets.filter(b => b.id !== budgetId) }));
  },

  // Regras de Mapeamento (com Supabase) 
  fetchMappingRules: async () => {
    const { data, error } = await supabase.from('mapping_rules').select('*').range(0, 9999);
    if (error) console.error('Erro ao buscar regras:', error);
    else set({ mappingRules: data as MappingRule[] });
  },
  addMappingRule: async (ruleData) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('mapping_rules').insert([{ ...ruleData, user_id: user.id }]).select();
    if (error) console.error('Erro ao adicionar regra:', error);
    else if (data) {
      const newRule = data[0] as MappingRule;
      set((state) => ({ mappingRules: [...state.mappingRules, newRule] }));
      get().applyRuleToExistingTransactions(newRule);
    }
  },
  updateMappingRule: async (updatedRule) => {
    const { id, ...fieldsToUpdate } = updatedRule;
    const { data, error } = await supabase.from('mapping_rules').update(fieldsToUpdate).eq('id', id).select();
    if (error) console.error('Erro ao atualizar regra:', error);
    else if (data) {
      const updated = data[0] as MappingRule;
      set((state) => ({ mappingRules: state.mappingRules.map(r => r.id === id ? updated : r) }));
      get().applyRuleToExistingTransactions(updated);
    }
  },
  deleteMappingRule: async (ruleId) => {
    const { error } = await supabase.from('mapping_rules').delete().eq('id', ruleId);
    if (error) console.error('Erro ao deletar regra:', error);
    else set((state) => ({ mappingRules: state.mappingRules.filter(r => r.id !== ruleId) }));
  },
  applyRuleToExistingTransactions: async (rule: MappingRule) => {
    const { transactions } = get();
    const keyword = rule.Texto_Contido_Descricao.toLowerCase();
    const cleanKeyword = keyword.replace(/\s+/g, ''); // Remove all whitespace for fuzzy match

    const transactionsToUpdate = transactions.filter(t => {
      const originalDesc = t.Descricao_Original ? t.Descricao_Original.toLowerCase() : '';
      const cleanOriginalDesc = originalDesc.replace(/\s+/g, '');

      // Check match:
      // 1. Exact substring match (standard)
      // 2. Whitespace-insensitive match (for banks with variable spacing)
      const match = originalDesc.includes(keyword) || cleanOriginalDesc.includes(cleanKeyword);

      if (match) {
        const needsUpdate = t.Categoria !== rule.Categoria_Sugerida || 
                          t.Nome_Fantasia !== rule.Nome_Fantasia_Sugerido ||
                          t.linked_asset_id !== rule.linked_asset_id;
        return needsUpdate;
      }
      return false;
    });

    // O upsert precisa de um array de objetos que correspondam à tabela.
    // O tipo `Partial<Transaction>` ajuda o TypeScript a entender a forma dos dados.
    const updatePayload: Partial<Transaction>[] = transactionsToUpdate.map(t => ({
      ID_Transacao: t.ID_Transacao,
      Categoria: rule.Categoria_Sugerida,
      Nome_Fantasia: rule.Nome_Fantasia_Sugerido,
      linked_asset_id: rule.linked_asset_id,
    }));

    if (updatePayload.length === 0) {
      return;
    }

    // FALLBACK: Se o upsert falhar por constraints, fazemos updates individuais.
    // Isso é mais seguro pois o update ignora colunas não fornecidas (como Data).
    const updatePromises = updatePayload.map(payload =>
      supabase.from('transactions')
        .update({ 
          Categoria: payload.Categoria, 
          Nome_Fantasia: payload.Nome_Fantasia,
          linked_asset_id: payload.linked_asset_id 
        })
        .eq('ID_Transacao', payload.ID_Transacao)
        .select()
    );

    const results = await Promise.all(updatePromises);

    const successfulUpdates = results.flatMap(r => (r.data && !r.error) ? [r.data[0] as Transaction] : []);
    const errors = results.filter(r => r.error).map(r => r.error);

    if (errors.length > 0) {
      console.error('Alguns updates falharam:', errors);
    }

    if (successfulUpdates.length > 0) {
      set(state => {
        const newTransactions = state.transactions.map(t => {
          const updated = successfulUpdates.find(u => u.ID_Transacao === t.ID_Transacao);
          if (updated) {
            return { 
              ...t, 
              Categoria: updated.Categoria, 
              Nome_Fantasia: updated.Nome_Fantasia,
              linked_asset_id: updated.linked_asset_id
            };
          }
          return t;
        });
        return { transactions: newTransactions };
      });

      // Recalcular saldo se a regra tiver vínculo
      if (rule.linked_asset_id) {
        await get().recalculateAssetBalance(rule.linked_asset_id);
      }
    }
  },

  // Admin Metrics
  fetchAdminMetrics: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    // Apenas tenta buscar se houver usúario e for o admin
    if (!user || user.email !== 'cassiomq@gmail.com') return;

    set({ isLoading: true });
    // Chama a function segura via RPC
    const { data, error } = await supabase.rpc('get_admin_metrics');
    if (error) {
      console.error('Erro ao buscar métricas de administrador:', error);
      set({ isLoading: false });
    } else {
      set({ adminMetrics: data as AdminMetrics, isLoading: false });
    }
  },

  reApplyAllRules: async () => {
    console.log('Fetching latest rules before re-applying...');
    await get().fetchMappingRules();
    const { mappingRules } = get();
    console.log(`Re-applying ${mappingRules.length} rules...`);

    for (const rule of mappingRules) {
      await get().applyRuleToExistingTransactions(rule);
    }
    console.log('All rules re-applied.');
  },

  findDuplicateRules: () => {
    const { mappingRules } = get();
    const normalizedMap = new Map<string, MappingRule[]>();

    mappingRules.forEach(rule => {
      const normalized = rule.Texto_Contido_Descricao.toLowerCase().replace(/\s+/g, '');
      if (!normalizedMap.has(normalized)) {
        normalizedMap.set(normalized, []);
      }
      normalizedMap.get(normalized)?.push(rule);
    });

    // Filter only groups with more than 1 rule
    const duplicates: MappingRule[][] = [];
    normalizedMap.forEach((rules) => {
      if (rules.length > 1) {
        duplicates.push(rules);
      }
    });

    return duplicates;
  },

  // Configurações de Importação (com Supabase)
  fetchImportConfigs: async () => {
    const { data, error } = await supabase.from('import_configs').select('*');
    if (error) console.error('Erro ao buscar configs de importação:', error);
    else set({ importConfigs: data as ImportConfig[] });
  },
  addImportConfig: async (config) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('import_configs').insert([{ ...config, user_id: user.id }]).select();
    if (error) console.error('Erro ao adicionar config de importação:', error);
    else if (data) set((state) => ({ importConfigs: [...state.importConfigs, data[0] as ImportConfig] }));
  },
  updateImportConfig: async (updatedConfig) => {
    const { id, ...fieldsToUpdate } = updatedConfig;
    const { data, error } = await supabase.from('import_configs').update(fieldsToUpdate).eq('id', id).select();
    if (error) console.error('Erro ao atualizar config de importação:', error);
    else if (data) set((state) => ({ importConfigs: state.importConfigs.map(c => c.id === id ? data[0] as ImportConfig : c) }));
  },
  deleteImportConfig: async (configId) => {
    const { error } = await supabase.from('import_configs').delete().eq('id', configId);
    if (error) console.error('Erro ao deletar config de importação:', error);
    else set((state) => ({ importConfigs: state.importConfigs.filter(c => c.id !== configId) }));
  },

  fetchImportLogs: async () => {
    const { data, error } = await supabase
      .from('import_logs')
      .select('*')
      .order('import_date', { ascending: false });

    if (error) {
      console.error('Erro ao buscar logs de importação:', error);
    } else {
      set({ importLogs: data as ImportLog[] });
    }
  },

  deleteImportLog: async (logId: string, fileName: string) => {
    console.log(`%c[deleteImportLog] Iniciando exclusão. ID: ${logId}, Arquivo: ${fileName}`, 'color: orange; font-weight: bold');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('[deleteImportLog] Usuário não autenticado.');
      return;
    }

    // 1. Delete transactions from this import
    console.log(`[deleteImportLog] Tentando excluir transações com Origem = "${fileName}"...`);
    const { error: txError, count } = await supabase
      .from('transactions')
      .delete({ count: 'exact' }) // Request count of deleted rows
      .eq('Origem', fileName)
      .eq('user_id', user.id);

    if (txError) {
      console.error('[deleteImportLog] Erro ao deletar transações:', txError);
      await appAlert('Erro ao deletar transações associadas. O log não será apagado.', 'Erro', 'danger');
      return;
    }
    console.log(`[deleteImportLog] Transações deletadas: ${count}`);

    // 2. Delete the log entry
    console.log(`[deleteImportLog] Tentando excluir log com ID = "${logId}"...`);
    const { error: logError } = await supabase
      .from('import_logs')
      .delete()
      .eq('id', logId);

    if (logError) {
      console.error('[deleteImportLog] Erro ao deletar log:', logError);
      await appAlert('Transações deletadas, mas erro ao apagar o log. Verifique as permissões (RLS) no Supabase.', 'Erro', 'danger');
    } else {
      console.log('[deleteImportLog] Log excluído com sucesso.');
      
      // Identify affected assets BEFORE updating local state
      const affectedAssetIds = new Set(
        get().transactions
          .filter(t => t.Origem === fileName && t.linked_asset_id)
          .map(t => t.linked_asset_id as string)
      );

      set((state) => ({
        importLogs: state.importLogs.filter(l => l.id !== logId),
        transactions: state.transactions.filter(t => t.Origem !== fileName)
      }));

      console.log('[deleteImportLog] Estado local atualizado.');

      // Recalcular saldo de todos os ativos afetados
      for (const assetId of affectedAssetIds) {
        await get().recalculateAssetBalance(assetId);
      }

      await appAlert('Importação e transações associadas excluídas com sucesso!', 'Sucesso', 'success');
    }
  },

  syncLegacyImportLogs: async () => {
    console.log('%c[syncLegacyImportLogs] Verificando histórico antigo...', 'color: blue');
    const { transactions, importLogs } = get();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Agrupar transações por Origem
    const legacyImports = new Map<string, { count: number, minDate: Date }>();
    transactions.forEach(t => {
      // Ignora transações manuais ou vazias
      if (t.Origem && t.Origem !== 'manual') {
        const current = legacyImports.get(t.Origem) || { count: 0, minDate: new Date(t.Data) };
        legacyImports.set(t.Origem, {
          count: current.count + 1,
          minDate: new Date(t.Data) < current.minDate ? new Date(t.Data) : current.minDate
        });
      }
    });

    console.log('[syncLegacyImportLogs] Origens encontradas nas transações:', Array.from(legacyImports.keys()));

    // 2. Filtrar as que já existem no log
    const newLogs: any[] = [];
    legacyImports.forEach((data, origin) => {
      const exists = importLogs.some(log => log.file_name === origin);
      if (!exists) {
        console.log(`[syncLegacyImportLogs] Encontrada origem sem log: "${origin}" (Transações: ${data.count}). Criando log...`);
        newLogs.push({
          user_id: user.id,
          file_name: origin,
          import_date: data.minDate.toISOString(),
          total_transactions: data.count,
          imported_count: data.count,
          ignored_count: 0,
          ignored_details: [],
          imported_details: [] // Added for legacy sync
        });
      }
    });

    // 3. Inserir novos logs
    if (newLogs.length > 0) {
      const { error } = await supabase.from('import_logs').insert(newLogs);
      if (error) {
        console.error('[syncLegacyImportLogs] Erro ao inserir novos logs:', error);
      } else {
        await get().fetchImportLogs();
        console.log(`[syncLegacyImportLogs] ${newLogs.length} logs recriados.`);
        // alert(`${newLogs.length} registros de importação antigos foram recuperados.`); // Comentado para não spammar se for automático
      }
    } else {
      console.log('[syncLegacyImportLogs] Nenhum log novo necessário.');
      // alert('O histórico já está atualizado.');
    }
  },

  // Support Tickets
  fetchSupportTickets: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*, messages:support_messages(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) console.error('Erro ao buscar chamados:', error);
    else set({ supportTickets: data as any }); // Cast needed due to complex join
  },

  fetchAllTickets: async () => {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*, messages:support_messages(*)')
      .order('created_at', { ascending: false });

    if (error) console.error('Erro ao buscar todos os chamados:', error);
    else set({ supportTickets: data as any });
  },

  createSupportTicket: async (ticketData, file?: File) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let attachment_url = undefined;
    if (file) {
      attachment_url = await get().uploadTicketAttachment(file) || undefined;
    }

    const { error } = await supabase.from('support_tickets').insert([{
      ...ticketData,
      user_id: user.id,
      attachment_url,
      status: 'open' // Default status
    }]);

    if (error) {
      console.error('Erro ao criar chamado:', error);
      await appAlert('Erro ao criar chamado: ' + error.message, 'Erro', 'danger');
    } else {
      await get().fetchSupportTickets();
      await appAlert('Chamado aberto com sucesso! Acompanhe na aba "Meus Chamados".', 'Sucesso', 'success');
    }
  },

  updateSupportTicketStatus: async (ticketId, status) => {
    const { error } = await supabase.from('support_tickets').update({ status }).eq('id', ticketId);
    if (error) {
      console.error('Erro ao atualizar status do chamado:', error);
    } else {
      set((state) => ({
        supportTickets: state.supportTickets.map(t => t.id === ticketId ? { ...t, status } : t)
      }));
    }
  },

  sendMessage: async (ticketId, message, file) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Check if locked BEFORE inserting
    const { supportTickets, fetchAllTickets, fetchSupportTickets } = get();
    const isAdmin = user.email === 'cassiomq@gmail.com';
    const ticket = supportTickets.find(t => t.id === ticketId);

    if (ticket && (ticket.status === 'resolved' || ticket.status === 'closed')) {
      if (!isAdmin) {
        await appAlert(`Este chamado está encerrado (Protocolo: ${ticket.protocol}). Por favor, abra um novo chamado informando este protocolo.`, 'Aviso', 'warning');
        return;
      }
    }

    let attachment_url = undefined;
    if (file) {
      attachment_url = await get().uploadTicketAttachment(file) || undefined;
    }

    // 2. Insert message
    const { error } = await supabase.from('support_messages').insert([{
      ticket_id: ticketId,
      sender_id: user.id,
      attachment_url,
      message
    }]);

    if (error) {
      console.error('Erro ao enviar mensagem:', error);
      await appAlert('Erro ao enviar mensagem: ' + error.message, 'Erro', 'danger');
      return;
    }

    // 3. Refresh tickets to show new message
    if (isAdmin) await fetchAllTickets();
    else await fetchSupportTickets();
  },

  uploadTicketAttachment: async (file) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `ticket-attachments/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('images') // Using existing bucket or need to create one. 
                        // The user usually has a 'images' or 'attachments' bucket.
                        // Based on standard supabase setup, 'images' is common.
        .upload(filePath, file);

      if (uploadError) {
        console.error('Error uploading file:', uploadError);
        return null;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('images')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error('Upload error:', error);
      return null;
    }
  },

  respondToTicket: async () => { console.warn('Deprecated'); }, // Placeholder logic


  // Assinaturas (Stripe)
  fetchSubscription: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      set({ subscription: null, isPremium: false, isWealth: false, unlimitedSync: false });
      return;
    }

    try {
      // 1. Check direct subscription
      const { data: directSub, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['active', 'trialing', 'past_due', 'lifetime'])
        .maybeSingle();

      if (subError) console.error('Erro ao buscar assinatura direta:', subError);

      let effectiveSubscription = directSub as Subscription | null;
      let isInherited = false;

      // 2. If no direct sub, check if family member (excluding self-references)
      if (!effectiveSubscription) {
        const currentUserEmail = user.email?.toLowerCase().trim();
        const { data: familyEntries, error: familyError } = await supabase
          .from('family_members')
          .select('owner_id, owner_email, status, member_email')
          .ilike('member_email', currentUserEmail)
          .eq('status', 'accepted')
          .neq('owner_id', user.id); // Jamais herdar de si mesmo para evitar loops

        if (familyError) console.error('Erro ao buscar vinculos familiares:', familyError);
        
        console.log(`[Subscription] Diagnóstico de Herança:`, {
            buscandoPor: currentUserEmail,
            encontrados: familyEntries?.length || 0,
            detalhes: familyEntries
        });

        if (familyEntries && familyEntries.length > 0) {
          console.log(`[Subscription] Encontrados ${familyEntries.length} convites aceitos. Buscando assinatura do titular...`);
          
          // Busca a assinatura do primeiro vinculo que tiver uma assinatura ativa
          for (const entry of familyEntries) {
            // BYPASS ADMIN: Se o titular for o Cassio, ele é Premium por definição
            if (entry.owner_email === 'cassiomq@gmail.com') {
              console.log('%c[Subscription] Herança confirmada de: cassiomq@gmail.com (Via Admin Bypass)', 'color: #ff9900; font-weight: bold;');
              effectiveSubscription = {
                status: 'lifetime',
                plan_type: 'lifetime',
                tier: 'wealth',
                plan: 'founders_pack',
                family_slots: 5,
                unlimited_sync: true
              } as any;
              isInherited = true;
              break;
            }

            const { data: ownerSub, error: ownerSubError } = await supabase
              .from('subscriptions')
              .select('*')
              .eq('user_id', entry.owner_id)
              .in('status', ['active', 'trialing', 'past_due', 'lifetime'])
              .maybeSingle();

            if (ownerSubError) console.error(`Erro ao buscar assinatura do titular (${entry.owner_email}):`, ownerSubError);
            
            if (ownerSub) {
              console.log(`[Subscription] Herança confirmada de: ${entry.owner_email}`);
              effectiveSubscription = ownerSub as Subscription;
              isInherited = true;
              break; // Encontrou uma assinatura válida, para de procurar
            }
          }
        } else {
          console.log('[Subscription] Nenhum convite aceito de terceiros encontrado.');
        }
      }
      
      const email = user.email?.toLowerCase().trim();
      const isAdmin = email === 'cassiomq@gmail.com';
      
      // Ajustar isPremium para incluir past_due (já que o banco permite acesso)
      const isPremium = isAdmin || ['active', 'lifetime', 'trialing', 'past_due'].includes(effectiveSubscription?.status || '');
      const isWealth = isAdmin || effectiveSubscription?.status === 'lifetime' || effectiveSubscription?.tier === 'wealth';
      const unlimitedSync = isAdmin || (effectiveSubscription?.unlimited_sync === true);


      set({ 
        subscription: effectiveSubscription, 
        isPremium, 
        isWealth, 
        unlimitedSync,
        isLoading: false
      });
    } catch (err) {
      console.error('Erro inesperado ao buscar assinatura:', err);
    }
  },

  // Assets (Patrimônio) Actions
  fetchAssets: async () => {
    const { data, error } = await supabase.from('assets').select('*').order('name');
    if (error) console.error('Erro ao buscar ativos:', error);
    else {
      set({ assets: data as Asset[] });
      // Sincronizar saldos de todos os ativos financiados na carga inicial
      // Usamos um delay curto ou fazemos em background
      get().recalculateAllAssetBalances();
    }
  },

  fetchFounderCount: async () => {
    // Usamos RPC para contornar o RLS e pegar a contagem global, mesmo deslogado
    const { data, error } = await supabase.rpc('get_founder_count');

    if (error) {
      console.error('Erro ao buscar contagem de Founders:', error);
    } else {
      set({ founderCount: data || 0 });
    }
  },

  addAsset: async (assetData) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('assets').insert([{ ...assetData, user_id: user.id }]).select();
    if (error) console.error('Erro ao adicionar ativo:', error);
    else if (data) {
      set((state) => ({ assets: [...state.assets, data[0] as Asset] }));
      // Disparar recálculo se for financiado
      if (data[0].is_financed) {
        await get().recalculateAssetBalance(data[0].id);
      }
    }
  },

  updateAsset: async (updatedAsset) => {
    const { id, ...fieldsToUpdate } = updatedAsset;
    const { data, error } = await supabase.from('assets').update({ ...fieldsToUpdate, updated_at: new Date().toISOString() }).eq('id', id).select();
    if (error) console.error('Erro ao atualizar ativo:', error);
    else if (data) {
      set((state) => ({ assets: state.assets.map(a => a.id === id ? data[0] as Asset : a) }));
      // Disparar recálculo se for financiado
      if (data[0].is_financed) {
        await get().recalculateAssetBalance(id);
      }
    }
  },

  deleteAsset: async (assetId) => {
    const { error } = await supabase.from('assets').delete().eq('id', assetId);
    if (error) console.error('Erro ao deletar ativo:', error);
    else set((state) => ({ assets: state.assets.filter(a => a.id !== assetId) }));
  },

  recalculateAssetBalance: async (assetId: string) => {
    const asset = get().assets.find(a => a.id === assetId);
    if (!asset || !asset.is_financed) return;

    const { data: linkedTransactions, error } = await supabase
      .from('transactions')
      .select('Valor, Tipo')
      .eq('linked_asset_id', assetId);

    if (error) {
      console.error('Erro ao buscar transações vinculadas para recálculo:', error);
      return;
    }

    const totalPaid = linkedTransactions.reduce((sum, tx) => {
      // Despesa (Saída) é positiva para o abatimento da dívida
      // Renda (Entrada/Estorno) é negativa para o abatimento da dívida
      const value = tx.Tipo === 'Renda' ? -Math.abs(tx.Valor) : Math.abs(tx.Valor);
      return sum + value;
    }, 0);
    
    const paidCount = linkedTransactions.length;

    const updatedData = {
      remaining_balance: Math.max(0, (asset.financed_amount || 0) - totalPaid),
      paid_installments: paidCount,
      updated_at: new Date().toISOString()
    };

    const { error: updateError, data } = await supabase
      .from('assets')
      .update(updatedData)
      .eq('id', assetId)
      .select();

    if (updateError) {
      console.error('Erro ao atualizar saldo do ativo após recálculo:', updateError);
    } else if (data) {
      set((state) => ({
        assets: state.assets.map(a => a.id === assetId ? data[0] as Asset : a)
      }));
    }
  },

  recalculateAllAssetBalances: async () => {
    const { assets } = get();
    const financedAssets = assets.filter(a => a.is_financed);
    
    // Executamos sequencialmente para não sobrecarregar
    for (const asset of financedAssets) {
      await get().recalculateAssetBalance(asset.id);
    }
  },

  fetchPendingInvites: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('family_members')
      .select('*')
      .ilike('member_email', user.email?.toLowerCase().trim())
      .eq('status', 'pending');
    
    if (error) console.error('Erro ao buscar convites pendentes:', error);
    else set({ pendingInvites: data as FamilyMember[] });
  },

  respondToInvite: async (inviteId, status) => {
    const { error } = await supabase
      .from('family_members')
      .update({ status })
      .eq('id', inviteId);
    
    if (error) {
      console.error('Erro ao responder convite:', error);
      throw error;
    }

    set((state) => ({ 
      pendingInvites: state.pendingInvites.filter(i => i.id !== inviteId) 
    }));

    if (status === 'accepted') {
      await get().fetchSubscription();
      await get().fetchAllData();
    }
  },
}));