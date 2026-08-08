
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import Card from '../ui/Card';
import { useAppStore } from '../../hooks/useAppStore';
import { appAlert, appConfirm } from '../../hooks/useDialogStore';
import { Category, Budget, MappingRule, ImportConfig, ImportLog, Account, Asset } from '../../types';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Papa from 'papaparse';
import AccountModal from './AccountModal';
import CategoryModal from '../modals/CategoryModal';
import MappingRuleModal from '../modals/MappingRuleModal';
import ImportDetailsModal, { default as IgnoredDetailsModal } from '../modals/ImportDetailsModal';
import InviteMemberModal from '../modals/InviteMemberModal';
import AssetModal from '../modals/AssetModal';
import AssetDetailModal from '../modals/AssetDetailModal';
import { ChevronLeftIcon, ChevronRightIcon } from '../ui/icons';
import { TourButton } from '../TourButton';
import { formatCurrency, getCurrencyColorClass, getCurrencyBgClass } from '../../utils/formatters';
import {
    auditImportLogLedger,
    buildImportLogAlerts,
    importedDetailsHasTransactionIds,
    isImportedDetailRowsIncomplete,
    type ImportLogAlertContext,
} from '../../utils/importLogHealth';
import {
  FAMILY_MEMBER_NICKNAMES_METADATA_KEY,
  getOtherFamilyMemberEmail,
  normalizeFamilyMemberEmail,
  parseFamilyMemberNicknames,
  setFamilyMemberNickname,
} from '../../utils/familyMemberNicknames';

const SettingsView: React.FC = () => {
    const { categories, budgets, mappingRules, importConfigs, importLogs, assets, fetchAssets, addAsset, updateAsset, deleteAsset, addCategory, updateCategory, deleteCategory, addBudget, updateBudget, deleteBudget, addMappingRule, updateMappingRule, deleteMappingRule, addImportConfig, updateImportConfig, deleteImportConfig, deleteImportLog, addAccount, updateAccount, deleteAccount, accounts, user, atomicImportEnabled, transactions, fetchTransactions, fetchImportLogs, reassignTransactionsAccountByImportLog, reApplyAllRules, findDuplicateRules, isPremium, setCurrentView, creditCardShadowDashboard, creditCardReprocessJobs, refreshCreditCardShadowDashboard, fetchCreditCardReprocessJobs, rebuildCreditCardByPeriod, repairImportLogsImportedDetailsFromLedger, updateUserPreferences } = useAppStore();

    const [isCategoryModalOpen, setCategoryModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);

    // Family Plan Integration
    const [isInviteModalOpen, setInviteModalOpen] = useState(false);
    const [familyMembers, setFamilyMembers] = useState<any[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [nicknameDrafts, setNicknameDrafts] = useState<Record<string, string>>({});
    const [savingNicknameEmail, setSavingNicknameEmail] = useState<string | null>(null);

    const memberNicknames = useMemo(
        () => parseFamilyMemberNicknames(user?.user_metadata),
        [user?.user_metadata]
    );

    useEffect(() => {
        setNicknameDrafts(memberNicknames);
    }, [memberNicknames]);

    const handleSaveMemberNickname = async (email: string) => {
        const key = normalizeFamilyMemberEmail(email);
        if (!key) return;
        const draft = (nicknameDrafts[key] || '').trim();
        const current = memberNicknames[key] || '';
        if (draft === current) return;

        setSavingNicknameEmail(key);
        try {
            const nextNicknames = setFamilyMemberNickname(memberNicknames, email, draft);
            await updateUserPreferences({
                [FAMILY_MEMBER_NICKNAMES_METADATA_KEY]: nextNicknames,
            } as Record<string, unknown>);
        } finally {
            setSavingNicknameEmail(null);
        }
    };


    // Fetch members on load (or when tab is active) - Simplified logic
    const fetchFamilyMembers = async () => {
        setLoadingMembers(true);
        // This will only work if the user ran the SQL script. Otherwise it might error (table doesn't exist).
        // We'll wrap in try/catch to be safe.
        try {
            // Dynamic import to avoid circular dependencies if any, though supabase is singleton
            const { supabase } = await import('../../supabaseClient');
            const { data, error } = await supabase.from('family_members').select('*');
            if (!error && data) {
                setFamilyMembers(data);
            }
        } catch (e) {
            console.warn('Family table not found or error fetching', e);
        } finally {
            setLoadingMembers(false);
        }
    };

    // Security / App Lock Settings
    const [appPin, setAppPin] = useState(localStorage.getItem('finelo_app_pin') || '');
    const [pinEnabled, setPinEnabled] = useState(!!localStorage.getItem('finelo_app_pin'));

    const handleSavePin = async () => {
        if (appPin.length === 4 && /^\d+$/.test(appPin)) {
            localStorage.setItem('finelo_app_pin', appPin);
            setPinEnabled(true);
            await appAlert('PIN salvo com sucesso! O aplicativo será bloqueado ao iniciar.', 'Sucesso', 'success');
        } else {
            await appAlert('O PIN deve conter exatamente 4 dígitos numéricos.', 'Erro', 'danger');
        }
    };

    const handleRemovePin = async () => {
        localStorage.removeItem('finelo_app_pin');
        setAppPin('');
        setPinEnabled(false);
        await appAlert('PIN removido. O aplicativo iniciará normalmente sem bloqueio.', 'Sucesso', 'success');
    };

    // Load on mount
    React.useEffect(() => {
        fetchFamilyMembers();
    }, []);

    React.useEffect(() => {
        if (user?.email === 'cassiomq@gmail.com') {
            refreshCreditCardShadowDashboard();
            fetchCreditCardReprocessJobs();
        }
    }, [user?.email, accounts.length, transactions.length, refreshCreditCardShadowDashboard, fetchCreditCardReprocessJobs]);

    const [isBudgetModalOpen, setBudgetModalOpen] = useState(false);
    const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

    const [isMappingRuleModalOpen, setMappingRuleModalOpen] = useState(false);
    const [editingMappingRule, setEditingMappingRule] = useState<MappingRule | null>(null);

    const [isImportConfigModalOpen, setImportConfigModalOpen] = useState(false);
    const [editingImportConfig, setEditingImportConfig] = useState<ImportConfig | null>(null);

    const [isAccountModalOpen, setAccountModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<Account | null>(null);
    const [lastCreatedAccountId, setLastCreatedAccountId] = useState<string | null>(null);

    // Estado para o ano selecionado nos orçamentos
    const [selectedBudgetYear, setSelectedBudgetYear] = useState(new Date().getFullYear());

    const [isAssetModalOpen, setAssetModalOpen] = useState(false);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetDetailModalOpen, setAssetDetailModalOpen] = useState(false);
    const [viewingAsset, setViewingAsset] = useState<Asset | null>(null);

    // State for Import Log Details Modal
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [selectedLogDetails, setSelectedLogDetails] = useState<{
        fileName: string;
        ignoredDetails: any[];
        importedDetails: any[];
        ledgerTransactionIds: string[];
    } | null>(null);
    const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
    const [reassignTargetLog, setReassignTargetLog] = useState<ImportLog | null>(null);
    const [reassignAccountId, setReassignAccountId] = useState<string>('');
    const [isRebuildModalOpen, setIsRebuildModalOpen] = useState(false);
    const [rebuildAccountId, setRebuildAccountId] = useState('');
    const [rebuildFromDate, setRebuildFromDate] = useState('');
    const [rebuildToDate, setRebuildToDate] = useState('');
    const [repairImportLogsBusy, setRepairImportLogsBusy] = useState(false);

    const importAlertContext: ImportLogAlertContext = useMemo(
        () => ({
            accounts,
            transactions,
            transactionIds: new Set(
                transactions.map((transaction) => transaction.ID_Transacao).filter(Boolean)
            ),
        }),
        [accounts, transactions]
    );

    const handleSaveAsset = async (assetData: Omit<Asset, 'id' | 'user_id' | 'updated_at'>) => {
        if (editingAsset) {
            await updateAsset({ ...editingAsset, ...assetData });
            await appAlert(`Ativo "${editingAsset.name}" atualizado com sucesso!`, 'Sucesso', 'success');
        } else {
            await addAsset(assetData);
            await appAlert(`Ativo "${assetData.name}" adicionado com sucesso!`, 'Sucesso', 'success');
        }
        setAssetModalOpen(false);
        setEditingAsset(null);
    };

    const handleSaveAccount = async (accountData: Omit<Account, 'id' | 'user_id'>) => {
        if (editingAccount) {
            await updateAccount({ ...editingAccount, ...accountData });
            await appAlert(`Conta "${editingAccount.Nome_Conta}" atualizada com sucesso!`, 'Sucesso', 'success');
        } else {
            const newAccount = await addAccount(accountData);
            if (newAccount) {
                await appAlert(`Conta "${newAccount.Nome_Conta}" criada com sucesso!`, 'Sucesso', 'success');
                setLastCreatedAccountId(newAccount.id);
            }
        }
        setAccountModalOpen(false);
        setEditingAccount(null);
    };

    const handleSaveCategory = async (categoryData: Omit<Category, 'id'>) => {
        if (editingCategory) {
            await updateCategory({ ...editingCategory, ...categoryData });
            await appAlert(`Categoria "${categoryData.Nome_Categoria}" atualizada com sucesso!`, 'Sucesso', 'success');
            setEditingCategory(null);
            setCategoryModalOpen(false);
        } else {
            const result = await addCategory(categoryData);
            await appAlert(result.message, result.status === 'error' ? 'Erro' : 'Sucesso', result.status === 'error' ? 'danger' : 'success');
            // Só fecha o modal se a operação foi bem-sucedida (criada ou atualizada)
            if (result.status === 'created' || result.status === 'updated') {
                setEditingCategory(null);
                setCategoryModalOpen(false);
            }
        }
    };

    const openEditCategoryModal = (category: Category) => {
        setEditingCategory(category);
        setCategoryModalOpen(true);
    }

    const openNewCategoryModal = () => {
        setEditingCategory(null);
        setCategoryModalOpen(true);
    }

    const handleSaveBudget = async (budgetData: Omit<Budget, 'id'>) => {
        if (editingBudget) {
            await updateBudget({ ...editingBudget, ...budgetData, ano: selectedBudgetYear });
            await appAlert(`Orçamento para "${budgetData.Categoria}" atualizado com sucesso!`, 'Sucesso', 'success');
        } else {
            await addBudget({ ...budgetData, ano: selectedBudgetYear });
            await appAlert(`Orçamento para "${budgetData.Categoria}" criado com sucesso!`, 'Sucesso', 'success');
        }
        setEditingBudget(null);
        setBudgetModalOpen(false);
    };

    const openEditBudgetModal = (budget: Budget) => {
        setEditingBudget(budget);
        setBudgetModalOpen(true);
    }

    const openNewBudgetModal = () => {
        setEditingBudget(null);
        setBudgetModalOpen(true);
    }

    const handleSaveMappingRule = async (ruleData: Omit<MappingRule, 'id'>) => {
        if (editingMappingRule) {
            await updateMappingRule({ ...editingMappingRule, ...ruleData });
            await appAlert('Regra de mapeamento atualizada com sucesso!', 'Sucesso', 'success');
        } else {
            await addMappingRule(ruleData);
            await appAlert('Regra de mapeamento criada com sucesso!', 'Sucesso', 'success');
        }
        setEditingMappingRule(null);
        setMappingRuleModalOpen(false);
    };

    const openEditMappingRuleModal = (rule: MappingRule) => {
        setEditingMappingRule(rule);
        setMappingRuleModalOpen(true);
    }

    const openNewMappingRuleModal = () => {
        setEditingMappingRule(null);
        setMappingRuleModalOpen(true);
    }

    const handleSaveImportConfig = async (configData: Omit<ImportConfig, 'id'>) => {
        if (editingImportConfig) {
            await updateImportConfig({ ...editingImportConfig, ...configData });
            await appAlert(`Configuração "${configData.Nome_Fonte}" atualizada com sucesso!`, 'Sucesso', 'success');
        } else {
            await addImportConfig(configData);
            await appAlert(`Configuração "${configData.Nome_Fonte}" criada com sucesso!`, 'Sucesso', 'success');
        }
        setEditingImportConfig(null);
        setImportConfigModalOpen(false);
    };

    const openEditImportConfigModal = (config: ImportConfig) => {
        setEditingImportConfig(config);
        setImportConfigModalOpen(true);
    }

    const openNewImportConfigModal = () => {
        setEditingImportConfig(null);
        setImportConfigModalOpen(true);
    }

    const sortedCategories = useMemo(() =>
        [...categories].sort((a, b) => a.Nome_Categoria.localeCompare(b.Nome_Categoria))
        , [categories]);

    // Adiciona um ID único a cada orçamento para compatibilidade com o CrudCard.
    // Usamos o ID real do banco (UUID) para garantir que o delete funcione corretamente.
    const budgetsWithId = useMemo(() =>
        budgets
            .filter(b => b.ano === selectedBudgetYear)
            .map(budget => ({ ...budget })) // Maintain original budget object correctly
        , [budgets, selectedBudgetYear]);

    const categoryTypeColorMap: Record<Category['Tipo'], string> = {
        Renda: 'text-accent', // Verde
        Despesa: 'text-danger', // Vermelho
        Ambos: 'text-highlight' // Azul
    };

    const importConfigTypeMap: Record<ImportConfig['Tipo_Fonte'], string> = {
        Conta: 'Conta Corrente',
        'Conta Corrente': 'Conta Corrente',
        Poupança: 'Poupança',
        Investimento: 'Investimento',
        Cartao: 'Cartão de Crédito',
        'Cartão de Crédito': 'Cartão de Crédito',
        'Cartão Alimentação': 'Cartão Alimentação',
        Outro: 'Outro'
    };

    const importHistory = useMemo(() => {
        const history = new Map<string, number>();
        transactions.forEach(t => {
            if (t.Origem && t.Origem !== 'manual') {
                history.set(t.Origem, (history.get(t.Origem) || 0) + 1);
            }
        });
        return Array.from(history.entries()).map(([origin, count]) => ({
            id: origin,
            Origem: origin,
            Count: count
        }));
    }, [transactions]);

    const openReassignModal = useCallback((log: ImportLog) => {
        setReassignTargetLog(log);
        setReassignAccountId('');
        setIsReassignModalOpen(true);
    }, []);

    const applyReassignAccount = useCallback(async () => {
        if (!reassignTargetLog || !reassignAccountId) {
            await appAlert('Selecione uma conta para continuar.', 'Aviso', 'warning');
            return;
        }

        const accountName = accounts.find(a => a.id === reassignAccountId)?.Nome_Conta || 'conta selecionada';
        const ledgerAudit = atomicImportEnabled
            ? auditImportLogLedger(reassignTargetLog, transactions)
            : null;

        if (atomicImportEnabled && ledgerAudit?.activeCount === 0) {
            await appAlert(
                'Este lote não possui linhas ativas rastreáveis por ID. Nenhuma conta foi alterada.',
                'Conta não corrigida',
                'warning'
            );
            return;
        }

        const importDateLabel = new Date(reassignTargetLog.import_date).toLocaleString('pt-BR');
        const confirmationMessage = atomicImportEnabled && ledgerAudit
            ? `Esta ação moverá somente ${ledgerAudit.activeCount} linha${ledgerAudit.activeCount === 1 ? '' : 's'} ativa${ledgerAudit.activeCount === 1 ? '' : 's'} deste lote específico.\n\nArquivo: ${reassignTargetLog.file_name}\nImportado em: ${importDateLabel}\nDestino: ${accountName}\n\nOutros lotes, mesmo com nome igual, não serão alterados. Deseja continuar?`
            : `Isso irá mover todas as transações importadas de "${reassignTargetLog.file_name}" para "${accountName}". Deseja continuar?`;
        const confirm = await appConfirm(
            confirmationMessage,
            'Corrigir Conta da Importação',
            'Aplicar Correção',
            'warning'
        );

        if (!confirm) return;

        const result = await reassignTransactionsAccountByImportLog(reassignTargetLog.id, reassignAccountId);
        const selectedAccount = accounts.find(a => a.id === reassignAccountId);
        const isCreditCardTarget = selectedAccount?.Tipo_Conta === 'Cartão de Crédito';
        setIsReassignModalOpen(false);
        setReassignTargetLog(null);
        setReassignAccountId('');

        if (result.updated > 0) {
            await appAlert(
                isCreditCardTarget
                    ? `Conta corrigida com sucesso em ${result.updated} transações. A fatura foi atualizada automaticamente.`
                    : `Conta corrigida com sucesso em ${result.updated} transações.`,
                'Sucesso',
                'success'
            );
        } else {
            await appAlert('Nenhuma transação foi atualizada. Verifique se este arquivo possui lançamentos vinculados no histórico.', 'Aviso', 'warning');
        }
    }, [reassignTargetLog, reassignAccountId, accounts, reassignTransactionsAccountByImportLog, transactions, user]);

    const handleRepairImportLogPayloads = useCallback(async () => {
        const ok = await appConfirm(
            'Reidratar todos os registros do histórico onde o JSON não bate com o ledger (origens com transações já guardadas).\n\nNenhum lançamento é apagado — apenas alinha o histórico com o extrato que você já importou.',
            'Corrigir JSON do histórico',
            'Reidratar',
            'warning'
        );
        if (!ok) return;

        setRepairImportLogsBusy(true);
        try {
            const result = await repairImportLogsImportedDetailsFromLedger();
            await appAlert(result.message, 'Histórico de importações', result.updated > 0 ? 'success' : 'warning');
        } finally {
            setRepairImportLogsBusy(false);
        }
    }, [repairImportLogsImportedDetailsFromLedger]);

    const handleOpenRebuildModal = useCallback(() => {
        const firstCard = accounts.find(a => a.Tipo_Conta === 'Cartão de Crédito');
        setRebuildAccountId(firstCard?.id || '');
        setRebuildFromDate('');
        setRebuildToDate('');
        setIsRebuildModalOpen(true);
    }, [accounts]);

    const handleConfirmRebuild = useCallback(async () => {
        if (!rebuildAccountId || !rebuildFromDate || !rebuildToDate) {
            await appAlert('Preencha conta, data inicial e data final.', 'Aviso', 'warning');
            return;
        }

        const accountName = accounts.find(a => a.id === rebuildAccountId)?.Nome_Conta || 'conta selecionada';
        const ok = await appConfirm(
            `Reconstruir o Cartão V2 de "${accountName}" no período ${rebuildFromDate} até ${rebuildToDate}?`,
            'Reconstruir Cartão por Período',
            'Reconstruir',
            'warning'
        );
        if (!ok) return;

        const result = await rebuildCreditCardByPeriod(rebuildAccountId, rebuildFromDate, rebuildToDate);
        setIsRebuildModalOpen(false);
        await appAlert(result.message, 'Sucesso', 'success');
    }, [rebuildAccountId, rebuildFromDate, rebuildToDate, accounts, rebuildCreditCardByPeriod]);

    const importLogAccountLabelMap = useMemo(() => {
        const accountNames = new Map(accounts.map(a => [a.id, a.Nome_Conta]));
        const labels = new Map<string, string>();
        const normalizeOrigin = (value?: string) =>
            (value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim()
                .toLowerCase();
        const normalizeLoose = (value?: string) =>
            normalizeOrigin(value)
                .replace(/[^a-z0-9]+/g, ' ')
                .trim();
        const tokenize = (value?: string) => normalizeLoose(value).split(' ').filter(Boolean);

        importLogs.forEach((log) => {
            const importedDetails = (log.imported_details as any[]) || [];
            const exactIds = new Set(
                importedDetails
                    .map((detail) => detail?.ID_Transacao ?? detail?.transaction_id ?? detail?.transactionId)
                    .filter(Boolean)
                    .map(String)
            );
            const exactAccountFrequency = new Map<string, number>();
            transactions
                .filter((transaction) => exactIds.has(transaction.ID_Transacao) && transaction.ID_Conta)
                .forEach((transaction) => {
                    const accountId = transaction.ID_Conta as string;
                    exactAccountFrequency.set(accountId, (exactAccountFrequency.get(accountId) || 0) + 1);
                });

            if (exactAccountFrequency.size > 0) {
                const ordered = Array.from(exactAccountFrequency.entries()).sort((a, b) => b[1] - a[1]);
                const [topAccountId, topCount] = ordered[0];
                const totalCount = ordered.reduce((sum, [, count]) => sum + count, 0);
                const topName = accountNames.get(topAccountId) || 'Conta desconhecida';
                labels.set(
                    log.id,
                    exactAccountFrequency.size === 1
                        ? topName
                        : `Múltiplas (predomínio: ${topName} - ${Math.round((topCount / totalCount) * 100)}%)`
                );
                return;
            }

            const detailsAccountName = importedDetails.find(d => d?.Conta_Nome)?.Conta_Nome;

            if (detailsAccountName) {
                labels.set(log.id, detailsAccountName);
                return;
            }

            const accountFrequency = new Map<string, number>();
            const targetOrigin = normalizeOrigin(log.file_name);
            transactions
                .filter(t => normalizeOrigin(t.Origem) === targetOrigin && t.ID_Conta)
                .forEach(t => {
                    const key = t.ID_Conta as string;
                    accountFrequency.set(key, (accountFrequency.get(key) || 0) + 1);
                });

            if (accountFrequency.size === 0) {
                // Fallback 1: tentar inferir pela configuração de importação (logs legados)
                const normalizedFileName = normalizeLoose(log.file_name);
                const configCandidate = importConfigs
                    .filter(cfg => cfg.ID_Conta_Associada)
                    .map(cfg => ({
                        cfg,
                        score: tokenize(cfg.Nome_Fonte).filter(token => normalizedFileName.includes(token)).length
                    }))
                    .sort((a, b) => b.score - a.score)[0];

                if (configCandidate && configCandidate.score > 0 && configCandidate.cfg.ID_Conta_Associada) {
                    const inferred = accountNames.get(configCandidate.cfg.ID_Conta_Associada);
                    if (inferred) {
                        labels.set(log.id, inferred);
                        return;
                    }
                }

                // Fallback 2: heurística por nome da conta no nome do arquivo
                const accountCandidate = accounts
                    .map(acc => ({
                        account: acc,
                        score: tokenize(acc.Nome_Conta).filter(token => normalizedFileName.includes(token)).length
                    }))
                    .sort((a, b) => b.score - a.score)[0];

                if (accountCandidate && accountCandidate.score > 0) {
                    labels.set(log.id, accountCandidate.account.Nome_Conta);
                    return;
                }

                labels.set(log.id, 'Não associada');
                return;
            }

            if (accountFrequency.size === 1) {
                const accountId = Array.from(accountFrequency.keys())[0];
                labels.set(log.id, accountNames.get(accountId) || 'Conta desconhecida');
                return;
            }

            const ordered = Array.from(accountFrequency.entries()).sort((a, b) => b[1] - a[1]);
            const [topAccountId, topCount] = ordered[0];
            const totalCount = ordered.reduce((sum, [, count]) => sum + count, 0);
            const topName = accountNames.get(topAccountId) || 'Conta desconhecida';
            labels.set(log.id, `Múltiplas (predomínio: ${topName} - ${Math.round((topCount / totalCount) * 100)}%)`);
        });

        return labels;
    }, [importLogs, accounts, transactions, importConfigs]);

    const isImportedDetailsIncomplete = useCallback((rows: any[]) => isImportedDetailRowsIncomplete(rows), []);

    const fetchImportedDetailsFromTransactions = useCallback(async (origin: string) => {
        const { supabase } = await import('../../supabaseClient');
        const { data, error } = await supabase
            .from('transactions')
            .select('ID_Transacao, Data, Descricao_Original, Nome_Fantasia, Valor, Categoria, ID_Conta')
            .eq('Origem', origin)
            .order('Data', { ascending: true });
        if (error) {
            console.error('Falha ao carregar transações por origem no modal de detalhes:', error);
            return [];
        }
        return (data || []).map((tx: any) => ({
            ID_Transacao: tx.ID_Transacao,
            Data: tx.Data,
            Descricao_Original: tx.Descricao_Original,
            Nome_Fantasia: tx.Nome_Fantasia,
            Valor: tx.Valor,
            Categoria: tx.Categoria,
            ID_Conta: tx.ID_Conta,
        }));
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <h1 className="text-3xl font-bold text-light">Configurações</h1>
                <TourButton currentView="settings" />
            </div>

            <div className="space-y-6">
                {/* 1. Gerenciar Configurações de Importação */}
                <div id="settings-configs" className="lg:col-span-2">
                    <CrudCard<ImportConfig>
                        title="Gerenciar Configurações de Importação"
                        data={importConfigs} headers={['Fonte', 'Tipo']}
                        renderRow={(item: ImportConfig) => (
                            <>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-white">{item.Nome_Fonte}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-400">{importConfigTypeMap[item.Tipo_Fonte]}</td>
                            </>
                        )}
                        onAdd={openNewImportConfigModal}
                        onEdit={openEditImportConfigModal}
                        onDelete={async (id) => {
                            const config = importConfigs.find(c => c.id === id);
                            if (!config) return;

                            const confirmConfig = await appConfirm(`Tem certeza que deseja remover a configuração para "${config.Nome_Fonte}"?`, 'Excluir Configuração', 'Excluir', 'danger');
                            if (!confirmConfig) return;

                            await deleteImportConfig(id);

                            if (config.ID_Conta_Associada) {
                                const account = accounts.find(a => a.id === config.ID_Conta_Associada);
                                const accountName = account ? account.Nome_Conta : 'a conta associada';

                                if (await appConfirm(`Deseja, TAMBÉM, excluir ${accountName} e todas as transações associadas?\n\nIsso limpará completamente os dados vindos desta fonte.`, 'Excluir Conta e Transações', 'Excluir Tudo', 'danger', 'Não')) {
                                    if (config.ID_Conta_Associada) {
                                        await deleteAccount(config.ID_Conta_Associada);
                                        await appAlert('Conta e transações excluídas.', 'Sucesso', 'success');
                                    }
                                }
                            }
                        }}
                        searchKeys={['Nome_Fonte', 'Tipo_Fonte']}
                        searchPlaceholder="Buscar por fonte ou tipo..."
                    />
                </div>

                {/* 2. Gerenciar Contas */}
                <div id="settings-manage-accounts" data-tour="settings-accounts" className="lg:col-span-2 min-h-[100px]">
                    <CrudCard<Account>
                        title="Gerenciar Contas"
                        data={accounts}
                        headers={['Nome', 'Tipo', 'Saldo Inicial']}
                        renderRow={(item) => (
                            <>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-white flex items-center gap-2">
                                    {item.Nome_Conta}
                                    {item.is_archived && <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider" title="Conta arquivada e oculta dos painéis">📦 Arquivada</span>}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-400 font-medium lowercase italic">{item.Tipo_Conta}</td>
                                <td className={`px-4 py-4 whitespace-nowrap text-sm font-semibold ${item.is_archived ? 'text-gray-500 line-through' : getCurrencyColorClass(item.Saldo_Inicial, 'text-accent')}`}>
                                    {formatCurrency(item.Saldo_Inicial)}
                                </td>
                            </>
                        )}
                        onAdd={() => { setEditingAccount(null); setAccountModalOpen(true); }}
                        onEdit={(item) => { setEditingAccount(item); setAccountModalOpen(true); }}
                        renderExtraActions={(item) => (
                            <button className="text-orange-400 hover:text-orange-300 transition-colors font-semibold p-1 lg:px-0 lg:py-0 lg:ml-2" onClick={async () => {
                                if (await appConfirm(item.is_archived ? 'Deseja desarquivar esta conta?' : 'Deseja arquivar esta conta? O histórico será mantido, mas ela não aparecerá mais nos resumos.', item.is_archived ? 'Desarquivar' : 'Arquivar Conta', item.is_archived ? 'Desarquivar' : 'Arquivar', 'warning')) {
                                    const { archiveAccount } = useAppStore.getState();
                                    await archiveAccount(item.id, !item.is_archived);
                                }
                            }}>
                                {item.is_archived ? 'Desarquivar' : 'Arquivar'}
                            </button>
                        )}
                        onDelete={async (id) => {
                            if (await appConfirm('Tem certeza que deseja excluir esta conta? Isso só é possível se não houver transações.', 'Excluir Conta', 'Excluir', 'danger')) {
                                try {
                                    await deleteAccount(id);
                                } catch (err: any) {
                                    if (err.message === 'has_transactions') {
                                        await appAlert('Não é possível excluir esta conta pois ela possui transações vinculadas.\nPara ocultá-la sem perder o histórico, use a opção "Arquivar".', 'Erro', 'danger');
                                    } else {
                                        await appAlert('Erro ao excluir conta.', 'Erro', 'danger');
                                    }
                                }
                            }
                        }}
                        searchKeys={['Nome_Conta', 'Tipo_Conta']}
                        searchPlaceholder="Buscar conta..."
                    />
                </div>

                {/* 3. Histórico de Importações */}
                <div id="settings-logs" className="lg:col-span-2">
                    <CrudCard<ImportLog>
                        title="Histórico de Importações"
                        data={importLogs}
                        headers={['Arquivo', 'Conta Escolhida', 'Data da Importação', 'Total', 'Importados', 'Ignorados', 'Alertas']}
                        renderRow={(item) => {
                            const alerts = buildImportLogAlerts(item, importAlertContext);
                            return (
                            <>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-white">{item.file_name}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-xs text-gray-300 font-medium">
                                    {importLogAccountLabelMap.get(item.id) || 'Não associada'}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-xs text-gray-400">{new Date(item.import_date).toLocaleString()}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-center font-bold text-gray-300">{item.total_transactions}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-center font-bold text-accent">{item.imported_count}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-center font-bold text-danger">{item.ignored_count}</td>
                                <td className="px-4 py-3 align-top text-center">
                                    {alerts.badges.length === 0 ? (
                                        <span className="text-sm text-slate-500" title="Nenhum alerta detectado por heurística">—</span>
                                    ) : (
                                        <div className="flex flex-wrap gap-1 justify-center max-w-[240px] mx-auto">
                                            {alerts.badges.map((b, i) => (
                                                <span
                                                    key={`${item.id}-${i}`}
                                                    title={b}
                                                    className={
                                                        alerts.level === 'error'
                                                            ? 'inline-flex px-2 py-0.5 rounded text-[10px] font-semibold leading-tight border border-red-500/40 bg-red-500/15 text-red-200'
                                                            : 'inline-flex px-2 py-0.5 rounded text-[10px] font-semibold leading-tight border border-amber-500/35 bg-amber-500/10 text-amber-100'
                                                    }
                                                >
                                                    {b}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </td>
                            </>
                            );
                        }}
                        onAdd={() => { }}
                        onEdit={async (item) => {
                            if (item.ignored_count > 0 || item.imported_count > 0) {
                                let importedDetails = Array.isArray(item.imported_details) ? item.imported_details : [];
                                const hasExactIds = importedDetailsHasTransactionIds(importedDetails);
                                /** Logs antigos: `imported_count` vinha das linhas tentadas, não do retorno do insert+.select(). */
                                const countMismatchVersusPayload = item.imported_count !== importedDetails.length;
                                const needsFallback =
                                    !hasExactIds && (
                                        countMismatchVersusPayload ||
                                        isImportedDetailsIncomplete(importedDetails) ||
                                        (item.imported_count > 1 && importedDetails.length <= 1)
                                    );
                                if (needsFallback) {
                                    const sameNameLogs = importLogs.filter((log) => log.file_name === item.file_name);
                                    const fallback = sameNameLogs.length === 1
                                        ? await fetchImportedDetailsFromTransactions(item.file_name)
                                        : [];
                                    if (fallback.length > 0 && (fallback.length > importedDetails.length || countMismatchVersusPayload)) {
                                        importedDetails = fallback;
                                    }
                                }
                                setSelectedLogDetails({
                                    fileName: item.file_name,
                                    ignoredDetails: item.ignored_details || [],
                                    importedDetails,
                                    ledgerTransactionIds: transactions
                                        .map((transaction) => transaction.ID_Transacao)
                                        .filter((id): id is string => Boolean(id)),
                                });
                                setIsDetailsModalOpen(true);
                            } else {
                                appAlert('Não há transações nesta importação para visualizar.', 'Aviso');
                            }
                        }}
                        onDelete={async (id) => {
                            const log = importLogs.find(l => l.id === id);
                            if (log && await appConfirm(`ATENÇÃO: Isso excluirá o registro de importação "${log.file_name}" E TODAS AS TRANSAÇÕES associadas a ele. Deseja continuar?`, 'Excluir Importação', 'Excluir Tudo', 'danger')) {
                                await deleteImportLog(id, log.file_name);
                            }
                        }}
                        renderExtraActions={(item) => (
                            <button
                                className="text-amber-400 hover:text-amber-300 transition-colors font-semibold p-1 lg:px-0 lg:py-0 lg:ml-2"
                                onClick={() => openReassignModal(item)}
                                title="Corrigir conta desta importação"
                            >
                                Corrigir Conta
                            </button>
                        )}
                        searchKeys={['file_name']}
                        searchPlaceholder="Buscar por nome do arquivo..."
                        hideAddButton={true}
                        hideEditButton={false}
                        editLabel="Exibir"
                        footer={
                            <div className="mt-4 border-t border-slate-700 pt-4 space-y-3">
                                <p className="text-[11px] text-slate-500 leading-relaxed">
                                    O histórico de faturas do cartão é calculado pelas transações importadas. Use as ações abaixo
                                    só para corrigir metadados do histórico ou recuperar importações antigas — competências e
                                    saldos residuais são ajustados em <span className="text-slate-400">Transações</span>.
                                </p>
                                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                                <Button
                                    variant="secondary"
                                    disabled={repairImportLogsBusy}
                                    onClick={handleRepairImportLogPayloads}
                                    className="w-full sm:w-auto"
                                    title="Alinha imported_details/imported_count com as transações já guardadas (preserva competência/vencimento)"
                                >
                                    {repairImportLogsBusy ? 'Reidratando…' : 'Reidratar histórico de importações'}
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={async () => {
                                        if (await appConfirm('Isso irá verificar suas transações existentes e criar logs para importações antigas que não estão listadas aqui. Deseja continuar?', 'Sincronizar Histórico')) {
                                            const { syncLegacyImportLogs } = useAppStore.getState();
                                            await syncLegacyImportLogs();
                                        }
                                    }}
                                    disabled={repairImportLogsBusy}
                                    className="w-full sm:w-auto"
                                >
                                    Sincronizar Histórico Antigo
                                </Button>
                                </div>
                            </div>
                        }
                    />
                </div>

                {/* 4. Gerenciar Categorias */}
                <div id="settings-categories">
                    <CrudCard<Category>
                        title="Gerenciar Categorias"
                        data={sortedCategories}
                        headers={['Nome', 'Tipo', 'Invest.', 'Essencial?']}
                        renderRow={(item: Category) => (
                            <>
                                <td className="px-4 py-4 text-sm">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${item.Tipo === 'Renda' ? 'bg-accent' : item.Tipo === 'Despesa' ? 'bg-danger' : 'bg-highlight'}`} />
                                        <span className="font-medium text-white">{item.Nome_Categoria}</span>
                                    </div>
                                </td>
                                <td className={`px-4 py-4 whitespace-nowrap text-xs font-bold uppercase tracking-wider ${categoryTypeColorMap[item.Tipo]}`}>
                                    {item.Tipo === 'Renda' ? 'Entrada' : item.Tipo === 'Despesa' ? 'Saída' : 'Movimentação'}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-center">
                                    {item.is_investment ? (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                            Sim
                                        </span>
                                    ) : (
                                        <span className="text-gray-600 font-medium">Não</span>
                                    )}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-center">
                                    {!item.is_investment && (item.Tipo === 'Despesa' || item.Tipo === 'Ambos') ? (
                                        item.is_essential ? (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                                Sim
                                            </span>
                                        ) : (
                                            <span className="text-gray-600 font-medium text-xs uppercase tracking-tight">Opcional</span>
                                        )
                                    ) : (
                                        <span className="text-gray-700">-</span>
                                    )}
                                </td>
                            </>
                        )}
                        onAdd={openNewCategoryModal}
                        onEdit={openEditCategoryModal}
                        onDelete={async (id) => { if (await appConfirm('Deseja excluir esta categoria?', 'Excluir Categoria', 'Excluir', 'danger')) await deleteCategory(id) }}
                        searchKeys={['Nome_Categoria', 'Tipo']}
                        searchPlaceholder="Buscar por nome ou tipo..."
                    />
                </div>

                {/* 5. Gerenciar Orçamentos */}
                <div id="settings-budgets">
                    <CrudCard<Budget & { id: string }>
                        title="Gerenciar Orçamentos"
                        data={budgetsWithId}
                        headers={['Categoria', 'Limite Mensal']}
                        renderRow={(item: Budget) => (
                            <>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">{item.Categoria}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold text-accent">{formatCurrency(item.Valor_Limite_Mensal)}</td>
                            </>
                        )}
                        onAdd={openNewBudgetModal}
                        onEdit={openEditBudgetModal}
                        onDelete={async (id) => { if (await appConfirm('Deseja excluir este orçamento?', 'Excluir Orçamento', 'Excluir', 'danger')) await deleteBudget(id) }}
                        searchKeys={['Categoria', 'Valor_Limite_Mensal']}
                        searchPlaceholder="Buscar por categoria ou limite..."
                        extraHeader={
                            <div className="flex items-center justify-center gap-4 bg-slate-800/50 p-2 rounded-lg border border-slate-700">
                                <button
                                    onClick={() => setSelectedBudgetYear(prev => prev - 1)}
                                    className="p-1 rounded-full hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                                    title="Ano Anterior"
                                >
                                    <ChevronLeftIcon className="w-5 h-5" />
                                </button>
                                <span className="text-lg font-bold text-white min-w-[80px] text-center">
                                    {selectedBudgetYear}
                                </span>
                                <button
                                    onClick={() => setSelectedBudgetYear(prev => prev + 1)}
                                    className="p-1 rounded-full hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                                    title="Próximo Ano"
                                >
                                    <ChevronRightIcon className="w-5 h-5" />
                                </button>
                            </div>
                        }
                    />
                </div>

                {/* 6. Patrimônio (Ativos Fixos) */}
                <div id="settings-manage-assets" className="lg:col-span-2">
                    <CrudCard<Asset>
                        title="Patrimônio (Ativos Fixos)"
                        data={assets}
                        headers={['Nome', 'Tipo / Status', 'Valor Bruto', 'Dívida', 'P. Líquido (Equity)']}
                        renderRow={(item) => (
                            <>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-white">{item.name}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-gray-400 font-medium">
                                            {item.type === 'car' ? 'Veículo' : item.type === 'property' ? 'Imóvel' : 'Outro'}
                                        </span>
                                        {item.is_financed && (
                                            <div className="flex items-center gap-2">
                                                <div className="w-16 h-1.5 bg-slate-700/50 rounded-full overflow-hidden" title={`${item.paid_installments || 0}/${item.total_installments || 0} parcelas`}>
                                                    <div
                                                        className="h-full bg-highlight shadow-[0_0_8px_rgba(0,195,255,0.5)]"
                                                        style={{ width: `${((item.paid_installments || 0) / (item.total_installments || 1)) * 100}%` }}
                                                    ></div>
                                                </div>
                                                <span className={`text-[9px] font-black uppercase tracking-tighter shadow-sm ${
                                                    item.financing_type === 'consortium' ? 'text-purple-400' : 'text-highlight'
                                                }`}>
                                                    {item.financing_type === 'consortium' ? '🔄 Consórcio' : '🏦 Financiado'}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-300 font-medium">
                                    {formatCurrency(item.value)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-danger font-bold">
                                    {item.is_financed ? (
                                        formatCurrency(item.remaining_balance || 0)
                                    ) : (
                                        <span className="text-gray-700">-</span>
                                    )}
                                </td>
                                <td className={`px-4 py-4 whitespace-nowrap text-sm font-black ${getCurrencyColorClass(item.value - (item.is_financed ? (item.remaining_balance || 0) : 0))} ${getCurrencyBgClass(item.value - (item.is_financed ? (item.remaining_balance || 0) : 0))}`}>
                                    {formatCurrency(item.value - (item.is_financed ? (item.remaining_balance || 0) : 0))}
                                </td>
                            </>
                        )}
                        onAdd={() => { setEditingAccount(null); setAssetModalOpen(true); }}
                        onEdit={(item) => { setEditingAsset(item); setAssetModalOpen(true); }}
                        renderExtraActions={(item) => {
                            if (!item.is_financed && !item.financing_type) return null;
                            return (
                                <button
                                    className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg bg-highlight/10 text-highlight hover:bg-highlight/20 border border-highlight/30 hover:border-highlight/60 transition-all"
                                    onClick={() => { setViewingAsset(item); setAssetDetailModalOpen(true); }}
                                    title="Ver detalhes do financiamento / consórcio"
                                >
                                    📊 Detalhes
                                </button>
                            );
                        }}
                        onDelete={async (id) => {
                            if (await appConfirm('Excluir este ativo do seu patrimônio?', 'Excluir Ativo', 'Excluir', 'danger')) {
                                await deleteAsset(id);
                            }
                        }}
                        searchKeys={['name', 'type']}
                        searchPlaceholder="Buscar por nome ou tipo..."
                    />
                </div>

                {/* 7. Gerenciar Regras de Mapeamento */}
                <div id="settings-rules" className="lg:col-span-2">
                    <CrudCard<MappingRule>
                        title="Gerenciar Regras de Mapeamento"
                        data={mappingRules} headers={['Texto na Descrição', 'Nome Sugerido', 'Categoria Sugerida']}
                        renderRow={(item: MappingRule) => (
                            <>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-white">{item.Texto_Contido_Descricao}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-300">{item.Nome_Fantasia_Sugerido}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-highlight font-semibold">{item.Categoria_Sugerida}</td>
                            </>
                        )}
                        onAdd={openNewMappingRuleModal}
                        onEdit={openEditMappingRuleModal}
                        onDelete={async (id) => { if (await appConfirm('Deseja excluir esta regra?', 'Excluir Regra', 'Excluir', 'danger')) await deleteMappingRule(id) }}
                        searchKeys={['Texto_Contido_Descricao', 'Nome_Fantasia_Sugerido', 'Categoria_Sugerida']}
                        searchPlaceholder="Buscar por texto, nome ou categoria..."
                        footer={
                            <div className="mt-4 border-t border-slate-700 pt-4 flex gap-4">
                                <Button
                                    variant="secondary"
                                    onClick={async () => {
                                        if (await appConfirm('Isso irá verificar TODAS as transações e aplicar as regras correspondentes. Pode levar alguns instantes. Deseja continuar?', 'Re-aplicar Regras')) {
                                            await reApplyAllRules();
                                            await appAlert('Regras reaplicadas com sucesso!', 'Sucesso', 'success');
                                        }
                                    }}
                                    className="w-full sm:w-auto"
                                >
                                    Re-aplicar Todas as Regras
                                </Button>
                                <Button
                                    variant="danger"
                                    onClick={() => {
                                        const duplicates = findDuplicateRules();
                                        if (duplicates.length === 0) {
                                            appAlert('Nenhuma regra duplicada encontrada.', 'Tudo Certo', 'success');
                                            return;
                                        }

                                        const message = duplicates.map(group => {
                                            const text = group[0].Texto_Contido_Descricao;
                                            return `- "${text}" (${group.length} ocorrências)`;
                                        }).join('\n');

                                        appAlert(`Regras duplicadas encontradas:\n\n${message}\n\nPor favor, remova as duplicatas manualmente na lista acima.`, 'Atenção', 'warning');
                                    }}
                                    className="w-full sm:w-auto"
                                >
                                    Verificar Duplicatas
                                </Button>
                            </div>
                        }
                    />
                </div>

                {/* 8. Plano Família (Compartilhamento) */}
                <div id="settings-family" className="lg:col-span-2">
                    <Card className="flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <div className='flex items-center gap-2'>
                                <h2 className="text-xl font-bold text-light">Plano Família (Compartilhamento)</h2>
                                <span className="bg-accent/20 text-accent text-xs px-2 py-0.5 rounded-full border border-accent/50">Novo</span>
                            </div>
                            {isPremium ? (
                                <Button onClick={() => setInviteModalOpen(true)}>Adicionar Familiar</Button>
                            ) : (
                                <Button variant='accent' onClick={() => setCurrentView('pricing')}>
                                    💎 Seja Premium para Conviver
                                </Button>
                            )}
                        </div>

                        <div className="bg-primary rounded-lg border border-slate-700 p-4">
                            {familyMembers.length === 0 ? (
                                <div className="text-center text-gray-400 py-4">
                                    <p>Nenhum membro adicionado ainda.</p>
                                    <p className="text-sm mt-1">Convide alguém para ver e editar suas finanças em conjunto.</p>
                                    <p className="text-xs mt-2 text-gray-500">O convidado precisa aceitar o vínculo (banner no Dashboard ou botão aqui). Com status Aceito, ambos veem as transações um do outro.</p>
                                </div>
                            ) : (
                                <ul className="space-y-2">
                                    {familyMembers.map(member => {
                                        const isReceivedInvite = member.member_email?.toLowerCase().trim() === user?.email?.toLowerCase().trim();
                                        const displayName = isReceivedInvite ? `Responsável: ${member.owner_email}` : member.member_email;
                                        const isPendingReceived = isReceivedInvite && member.status === 'pending';
                                        const otherEmail =
                                            member.status === 'accepted'
                                                ? getOtherFamilyMemberEmail({
                                                      member,
                                                      currentUserId: user?.id,
                                                      currentUserEmail: user?.email,
                                                  })
                                                : null;
                                        const nicknameKey = otherEmail ? normalizeFamilyMemberEmail(otherEmail) : '';

                                        return (
                                            <li key={member.id} className="bg-slate-800 p-3 rounded gap-3 space-y-3">
                                                <div className="flex justify-between items-center gap-3">
                                                <span className="text-sm font-medium text-white min-w-0 truncate">{displayName}</span>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${member.status === 'accepted' ? 'text-green-400 bg-green-900/30' :
                                                        member.status === 'declined' ? 'text-danger bg-red-900/30' :
                                                            'text-yellow-400 bg-yellow-900/30'
                                                        }`}>
                                                        {member.status === 'accepted' ? 'Aceito' :
                                                            member.status === 'declined' ? 'Recusado' :
                                                                'Pendente'}
                                                    </span>
                                                    {isPendingReceived && (
                                                        <Button
                                                            className="!py-1 !px-2 text-[10px]"
                                                            onClick={async () => {
                                                                await useAppStore.getState().respondToInvite(member.id, 'accepted');
                                                                await fetchFamilyMembers();
                                                            }}
                                                        >
                                                            Aceitar
                                                        </Button>
                                                    )}
                                                    <button
                                                        onClick={async () => {
                                                            const msg = isReceivedInvite
                                                                ? `Sair do plano compartilhado de ${member.owner_email}?`
                                                                : `Remover acesso de ${member.member_email}?`;
                                                            if (!(await appConfirm(msg, 'Confirmar', 'Confirmar', 'danger'))) return;
                                                            const { supabase } = await import('../../supabaseClient');
                                                            await supabase.from('family_members').delete().eq('id', member.id);
                                                            fetchFamilyMembers();
                                                            if (isReceivedInvite) {
                                                                useAppStore.getState().fetchSubscription();
                                                            }
                                                        }}
                                                        className="text-danger hover:text-red-400 text-xs font-bold px-2 py-1"
                                                    >
                                                        {isReceivedInvite ? 'Sair' : 'Remover'}
                                                    </button>
                                                </div>
                                                </div>
                                                {otherEmail && nicknameKey ? (
                                                    <div className="flex flex-col sm:flex-row sm:items-end gap-2 pt-1 border-t border-white/5">
                                                        <div className="flex-1 min-w-0">
                                                            <Input
                                                                label="Apelido na auditoria"
                                                                name={`nickname-${member.id}`}
                                                                value={nicknameDrafts[nicknameKey] || ''}
                                                                onChange={(e) =>
                                                                    setNicknameDrafts((prev) => ({
                                                                        ...prev,
                                                                        [nicknameKey]: e.target.value,
                                                                    }))
                                                                }
                                                                placeholder="Ex: Alcione, Markus…"
                                                            />
                                                        </div>
                                                        <Button
                                                            variant="secondary"
                                                            className="sm:mb-0.5 shrink-0"
                                                            disabled={savingNicknameEmail === nicknameKey}
                                                            onClick={() => void handleSaveMemberNickname(otherEmail)}
                                                        >
                                                            {savingNicknameEmail === nicknameKey ? 'Salvando…' : 'Salvar apelido'}
                                                        </Button>
                                                        <p className="text-[10px] text-slate-500 sm:col-span-2">
                                                            Usado nos chips e agrupamentos em Transações (só para você).
                                                        </p>
                                                    </div>
                                                ) : null}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </Card>
                </div>
            </div>
            {user?.email === 'cassiomq@gmail.com' && (
                <div className="lg:col-span-2">
                    <Card className="flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-light">Cartão V2 — Modo Sombra (Divergências)</h2>
                            <div className="flex gap-2">
                                <Button variant="secondary" onClick={refreshCreditCardShadowDashboard}>
                                    Atualizar
                                </Button>
                                <Button variant="secondary" onClick={handleOpenRebuildModal}>
                                    Reconstruir Cartão
                                </Button>
                            </div>
                        </div>
                        {creditCardShadowDashboard.length === 0 ? (
                            <p className="text-sm text-gray-400">
                                Sem dados de comparação ainda. Importe uma fatura de cartão com o shadow mode ativo.
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {creditCardShadowDashboard.map((row) => {
                                    const badgeClass =
                                        row.status === 'ok'
                                            ? 'bg-green-500/20 text-green-300 border-green-500/40'
                                            : row.status === 'divergent'
                                                ? 'bg-red-500/20 text-red-300 border-red-500/40'
                                                : 'bg-slate-500/20 text-slate-300 border-slate-500/40';
                                    const badgeLabel =
                                        row.status === 'ok'
                                            ? 'OK'
                                            : row.status === 'divergent'
                                                ? 'Divergente'
                                                : 'Sem Dados';

                                    return (
                                        <div key={row.accountId} className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <p className="text-sm font-semibold text-white">{row.accountName}</p>
                                                <span className={`text-[11px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${badgeClass}`}>
                                                    {badgeLabel}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3 text-xs">
                                                <div>
                                                    <p className="text-gray-400">V1 (fatura líquida)</p>
                                                    <p className="text-white font-semibold">{formatCurrency(row.v1CurrentGross)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-400">V2 (charges)</p>
                                                    <p className="text-white font-semibold">{formatCurrency(row.v2CurrentGross)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-400">V2 (fatura líquida)</p>
                                                    <p className="text-white font-semibold">{formatCurrency(row.v2OpenAmount)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-400">Diferença</p>
                                                    <p className="text-amber-300 font-semibold">
                                                        {formatCurrency(row.absoluteDiff)} ({row.diffPercent.toFixed(2)}%)
                                                    </p>
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-gray-500 mt-2">
                                                Última origem analisada: {row.lastOrigin || '—'}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                </div>
            )}
            {user?.email === 'cassiomq@gmail.com' && (
                <div className="lg:col-span-2">
                    <Card className="flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-light">Cartão V2 — Auditoria de Reprocessamentos</h2>
                            <Button variant="secondary" onClick={fetchCreditCardReprocessJobs}>
                                Atualizar Logs
                            </Button>
                        </div>
                        {creditCardReprocessJobs.length === 0 ? (
                            <p className="text-sm text-gray-400">Nenhum reprocessamento registrado ainda.</p>
                        ) : (
                            <div className="overflow-x-auto rounded-xl border border-slate-700">
                                <table className="min-w-full divide-y divide-slate-800">
                                    <thead className="bg-slate-800/70">
                                        <tr>
                                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-400">Início</th>
                                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-400">Conta</th>
                                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-400">Status</th>
                                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-400">Resumo</th>
                                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-400">Fim</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        {creditCardReprocessJobs.map((job) => {
                                            const accountName = accounts.find(a => a.id === job.account_id)?.Nome_Conta || 'Conta desconhecida';
                                            const statusClass =
                                                job.status === 'success'
                                                    ? 'text-green-300 bg-green-500/15 border-green-500/30'
                                                    : job.status === 'failed'
                                                        ? 'text-red-300 bg-red-500/15 border-red-500/30'
                                                        : 'text-amber-300 bg-amber-500/15 border-amber-500/30';

                                            const summary = job.summary_json || {};
                                            const mode = typeof summary.mode === 'string' ? summary.mode : '-';
                                            const processed = typeof summary.processed === 'number' ? summary.processed : '-';
                                            const origin = typeof summary.origin === 'string' ? summary.origin : '';
                                            const range = typeof summary.fromDate === 'string' && typeof summary.toDate === 'string'
                                                ? `${summary.fromDate} → ${summary.toDate}`
                                                : '';

                                            return (
                                                <tr key={job.id} className="text-xs">
                                                    <td className="px-3 py-2 text-gray-300">{new Date(job.started_at).toLocaleString()}</td>
                                                    <td className="px-3 py-2 text-white font-medium">{accountName}</td>
                                                    <td className="px-3 py-2">
                                                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${statusClass}`}>
                                                            {job.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 text-gray-300">
                                                        <span className="font-semibold text-cyan-300">{mode}</span>
                                                        {processed !== '-' && <span> • {processed} itens</span>}
                                                        {origin && <span> • {origin}</span>}
                                                        {range && <span> • {range}</span>}
                                                    </td>
                                                    <td className="px-3 py-2 text-gray-400">
                                                        {job.finished_at ? new Date(job.finished_at).toLocaleString() : '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>
                </div>
            )}
            {user?.email === 'cassiomq@gmail.com' && (
                <div className="lg:col-span-2">
                    <CrudCard<any>
                        title="Backup e Restauração"
                        data={[]}
                        headers={[]}
                        renderRow={() => <></>}
                        onAdd={() => { }}
                        onEdit={() => { }}
                        onDelete={() => { }}
                        searchKeys={[]}
                        customBody={<BackupCard />}
                        hideAddButton={true} // Oculta o botão "Adicionar Novo"
                    />
                </div>
            )}

            {isDetailsModalOpen && selectedLogDetails && (
                <IgnoredDetailsModal
                    isOpen={isDetailsModalOpen}
                    onClose={() => setIsDetailsModalOpen(false)}
                    fileName={selectedLogDetails.fileName}
                    ignoredDetails={selectedLogDetails.ignoredDetails}
                    importedDetails={selectedLogDetails.importedDetails}
                    ledgerTransactionIds={selectedLogDetails.ledgerTransactionIds}
                />
            )}

            {isReassignModalOpen && reassignTargetLog && (
                <Modal
                    isOpen={isReassignModalOpen}
                    onClose={() => {
                        setIsReassignModalOpen(false);
                        setReassignTargetLog(null);
                        setReassignAccountId('');
                    }}
                    title="Corrigir Conta da Importação"
                    footer={
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => {
                                setIsReassignModalOpen(false);
                                setReassignTargetLog(null);
                                setReassignAccountId('');
                            }}>
                                Cancelar
                            </Button>
                            <Button onClick={applyReassignAccount}>
                                Aplicar
                            </Button>
                        </div>
                    }
                >
                    <div className="space-y-4">
                        <p className="text-sm text-gray-300">
                            Arquivo: <span className="font-semibold text-white">{reassignTargetLog.file_name}</span>
                        </p>
                        <Select
                            label="Mover transações para a conta"
                            value={reassignAccountId}
                            onChange={(e) => setReassignAccountId(e.target.value)}
                        >
                            <option value="">Selecione uma conta...</option>
                            {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>
                                    {acc.Nome_Conta}
                                </option>
                            ))}
                        </Select>
                        <p className="text-xs text-gray-500">
                            Esta ação atualiza em lote todas as transações com origem igual ao nome deste arquivo.
                        </p>
                    </div>
                </Modal>
            )}

            {isRebuildModalOpen && (
                <Modal
                    isOpen={isRebuildModalOpen}
                    onClose={() => setIsRebuildModalOpen(false)}
                    title="Reconstruir Cartão por Período"
                    footer={
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setIsRebuildModalOpen(false)}>
                                Cancelar
                            </Button>
                            <Button onClick={handleConfirmRebuild}>
                                Reconstruir
                            </Button>
                        </div>
                    }
                >
                    <div className="space-y-4">
                        <Select
                            label="Conta de Cartão"
                            value={rebuildAccountId}
                            onChange={(e) => setRebuildAccountId(e.target.value)}
                        >
                            <option value="">Selecione...</option>
                            {accounts
                                .filter(acc => acc.Tipo_Conta === 'Cartão de Crédito')
                                .map(acc => (
                                    <option key={acc.id} value={acc.id}>{acc.Nome_Conta}</option>
                                ))}
                        </Select>
                        <Input
                            label="Data inicial"
                            type="date"
                            value={rebuildFromDate}
                            onChange={(e) => setRebuildFromDate(e.target.value)}
                        />
                        <Input
                            label="Data final"
                            type="date"
                            value={rebuildToDate}
                            onChange={(e) => setRebuildToDate(e.target.value)}
                        />
                        <p className="text-xs text-gray-500">
                            Esta ação limpa e recalcula os ciclos V2 no intervalo informado, gerando log de auditoria.
                        </p>
                    </div>
                </Modal>
            )}

            {
                isCategoryModalOpen && (
                    <CategoryModal
                        category={editingCategory}
                        onClose={() => { setCategoryModalOpen(false); setEditingCategory(null); }}
                        onSave={handleSaveCategory}
                    />
                )
            }

            {
                isBudgetModalOpen && (
                    <BudgetModal
                        budget={editingBudget}
                        categories={categories}
                        onClose={() => { setBudgetModalOpen(false); setEditingBudget(null); }}
                        onSave={handleSaveBudget}
                    />
                )
            }

            {
                isMappingRuleModalOpen && (
                    <MappingRuleModal
                        rule={editingMappingRule}
                        categories={sortedCategories}
                        assets={assets}
                        onClose={() => { setMappingRuleModalOpen(false); setEditingMappingRule(null); }}
                        onSave={handleSaveMappingRule}
                    />
                )
            }

            {
                isImportConfigModalOpen && (
                    <ImportConfigModal
                        config={editingImportConfig}
                        onClose={() => { setImportConfigModalOpen(false); setEditingImportConfig(null); setLastCreatedAccountId(null); }}
                        onSave={handleSaveImportConfig}
                        onOpenCreateAccount={() => { setEditingAccount(null); setAccountModalOpen(true); }}
                        onOpenEditAccount={(accountId) => {
                            const accountToEdit = accounts.find(a => a.id === accountId);
                            if (accountToEdit) {
                                setEditingAccount(accountToEdit);
                                setAccountModalOpen(true);
                            }
                        }}
                        lastCreatedAccountId={lastCreatedAccountId}
                    />
                )
            }

            {
                isAccountModalOpen && (
                    <AccountModal
                        account={editingAccount}
                        onClose={() => { setAccountModalOpen(false); setEditingAccount(null); }}
                        onSave={handleSaveAccount}
                    />
                )
            }

            {isInviteModalOpen && (
                <InviteMemberModal
                    onClose={() => { setInviteModalOpen(false); fetchFamilyMembers(); }}
                    currentMembers={familyMembers}
                />
            )}
            {isAssetModalOpen && (
                <AssetModal
                    asset={editingAsset}
                    onClose={() => { setAssetModalOpen(false); setEditingAsset(null); }}
                    onSave={handleSaveAsset}
                />
            )}
            {isAssetDetailModalOpen && viewingAsset && (
                <AssetDetailModal
                    asset={viewingAsset}
                    onClose={() => { setAssetDetailModalOpen(false); setViewingAsset(null); }}
                    onEdit={() => {
                        setEditingAsset(viewingAsset);
                        setAssetDetailModalOpen(false);
                        setViewingAsset(null);
                        setAssetModalOpen(true);
                    }}
                />
            )}
        </div >
    );
};

interface CrudCardProps<T> {
    title: string;
    data: T[];
    headers: string[];
    renderRow: (item: T) => React.ReactNode;
    onAdd: () => void;
    onEdit: (item: T) => void;
    onDelete: (id: string) => void;
    searchKeys?: (keyof T)[];
    searchPlaceholder?: string;
    customBody?: React.ReactNode;
    hideAddButton?: boolean;
    hideEditButton?: boolean;
    footer?: React.ReactNode;
    extraHeader?: React.ReactNode;
    editLabel?: string;
    renderExtraActions?: (item: T) => React.ReactNode; // Per-row extra action buttons
}

// Function helper to handle mobile values.
const getRowChildren = (node: React.ReactNode): React.ReactNode[] => {
    let children: React.ReactNode[] = [];
    React.Children.forEach(node, (child) => {
        if (React.isValidElement(child) && child.type === React.Fragment) {
            children = children.concat(getRowChildren(child.props.children));
        } else {
            children.push(child);
        }
    });
    return children;
};

const CrudCard = <T extends { id: string },>({ title, data, headers, renderRow, onAdd, onEdit, onDelete, searchKeys = [], searchPlaceholder = 'Buscar...', customBody, hideAddButton = false, hideEditButton = false, footer, extraHeader, editLabel = 'Editar', renderExtraActions }: CrudCardProps<T>) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const filteredData = useMemo(() => {
        if (!searchTerm) return data;
        return data.filter(item => {
            return searchKeys.some(key => {
                const value = item[key];
                return String(value).toLowerCase().includes(searchTerm.toLowerCase());
            });
        });
    }, [data, searchTerm, searchKeys]);

    const paginatedData = useMemo(() => {
        if (itemsPerPage === -1) return filteredData; // -1 para "Todos"
        const startIndex = (currentPage - 1) * itemsPerPage;
        return filteredData.slice(startIndex, startIndex + itemsPerPage);
    }, [filteredData, currentPage, itemsPerPage]);

    const totalPages = itemsPerPage === -1 ? 1 : Math.ceil(filteredData.length / itemsPerPage);

    const handleItemsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setItemsPerPage(Number(e.target.value));
        setCurrentPage(1); // Reset to first page
    };

    return (
        <Card className="flex flex-col">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-light">{title}</h2>
                {!hideAddButton && (
                    <Button onClick={onAdd}>Adicionar Novo</Button>
                )}
            </div>
            {extraHeader && <div className="mb-4">{extraHeader}</div>}
            {searchKeys.length > 0 && (
                <div className="mb-4">
                    <Input
                        type="text"
                        placeholder={searchPlaceholder}
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    />
                </div>
            )}
            {customBody ? (
                <div className="mt-4">{customBody}</div>
            ) : (
                <>

                    <div className="flex-grow overflow-y-auto">
                        <div className="block lg:hidden space-y-3 mb-6">
                            {paginatedData.map(item => {
                                const rowEls = getRowChildren(renderRow(item));
                                return (
                                    <div key={item.id} className="bg-secondary p-4 rounded-xl shadow-md border border-slate-700/50 flex flex-col gap-2 relative">
                                        {headers.map((header, idx) => (
                                            <div key={header} className="flex justify-between items-center text-sm border-b border-slate-700/30 pb-1 last:border-0 last:pb-0">
                                                <span className="text-gray-500 font-medium text-xs">{header}</span>
                                                <span className="text-white font-semibold text-right max-w-[60%] truncate">
                                                    {/* For mobile layout we extract the inner text of the td */}
                                                    {(rowEls[idx] as any)?.props?.children || String(Object.values(item)[idx + 1] || '-')}
                                                </span>
                                            </div>
                                        ))}
                                        <div className="flex justify-end gap-3 mt-2 pt-2 border-t border-slate-700/30">
                                            {renderExtraActions && renderExtraActions(item)}
                                            {!hideEditButton && (
                                                <button className="text-highlight hover:text-sky-300 font-semibold p-1" onClick={() => onEdit(item)}>
                                                    {editLabel}
                                                </button>
                                            )}
                                            <button className="text-danger hover:text-red-400 font-semibold p-1" onClick={() => onDelete(item.id)}>
                                                Excluir
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                            {paginatedData.length === 0 && <p className="text-center text-gray-400 py-8">Nenhum item encontrado.</p>}
                        </div>

                        <div className="hidden lg:block bg-primary/30 rounded-xl shadow-2xl border border-white/5 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                            <table className="min-w-full divide-y divide-slate-800/50">
                                <thead className="bg-slate-800/80 backdrop-blur-md">
                                    <tr>
                                        {headers.map(header => <th key={header} scope="col" className="px-4 py-4 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">{header}</th>)}
                                        <th scope="col" className="px-4 py-4 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                    {paginatedData.map(item => (
                                        <tr key={item.id} className="hover:bg-white/5 transition-colors group">
                                            {renderRow(item)}
                                            <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                <div className="flex justify-end gap-3 opacity-60 group-hover:opacity-100 transition-opacity">
                                                    {renderExtraActions && renderExtraActions(item)}
                                                    {!hideEditButton && (
                                                        <button 
                                                            className="text-highlight hover:text-white transition-colors" 
                                                            onClick={() => onEdit(item)}
                                                        >
                                                            {editLabel}
                                                        </button>
                                                    )}
                                                    <button 
                                                        className="text-danger hover:text-white transition-colors" 
                                                        onClick={() => onDelete(item.id)}
                                                    >
                                                        Excluir
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {paginatedData.length === 0 && <p className="text-center text-gray-400 py-12">Nenhum item encontrado.</p>}
                        </div>
                    </div>
                    <div className="flex flex-col md:flex-row justify-between items-center mt-4 text-sm text-gray-400 gap-4">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                            <span>Mostrar</span>
                            <select
                                value={itemsPerPage}
                                onChange={handleItemsPerPageChange as any}
                                className="bg-primary/50 border border-slate-700 rounded text-white px-2 py-1 outline-none focus:border-highlight focus:ring-1 focus:ring-highlight appearance-none pr-8 cursor-pointer"
                                style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1em' }}
                            >
                                <option value="5">5</option>
                                <option value="10">10</option>
                                <option value="20">20</option>
                                <option value="50">50</option>
                                <option value="100">100</option>
                                <option value="200">200</option>
                                <option value="500">500</option>
                                <option value="1000">1000</option>
                                <option value="-1">Todos</option>
                            </select>
                            <span>registros</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-4">
                            <span>Página {currentPage} de {totalPages}</span>
                            <div className="flex gap-2">
                                <Button variant="secondary" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Anterior</Button>
                                <Button variant="secondary" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Próximo</Button>
                            </div>
                        </div>
                    </div>
                </>
            )}
            {footer && <div className="mt-4">{footer}</div>}
        </Card>
    );
};

// Modals removed from here and extracted to src/components/modals/

interface BudgetModalProps {
    budget: Budget | null;
    categories: Category[];
    onClose: () => void;
    onSave: (budget: Omit<Budget, 'id'>) => void;
}

const BudgetModal: React.FC<BudgetModalProps> = ({ budget, categories, onClose, onSave }) => {
    const [category, setCategory] = useState(budget?.Categoria || '');
    const [limit, setLimit] = useState(budget?.Valor_Limite_Mensal?.toString() || '');
    // Se estiver editando, usa o ano do orçamento. Se for novo, não temos acesso ao selectedBudgetYear aqui, mas o pai passará no onSave.
    // A validação de unicidade acontecerá no banco ou pode ser feita visualmente.
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!category) newErrors.category = 'A categoria é obrigatória.';
        const numericLimit = parseFloat(limit);
        if (!limit.trim()) newErrors.limit = 'O limite é obrigatório.';
        else if (isNaN(numericLimit) || numericLimit <= 0) newErrors.limit = 'O limite deve ser um número positivo.';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validate()) {
            // O ano será injetado pelo componente pai (SettingsView)
            onSave({ Categoria: category, Valor_Limite_Mensal: parseFloat(limit), ano: 0 }); // ano 0 como placeholder
        }
    };

    // Orçamentos só podem ser aplicados a categorias de Despesa ou Ambos.
    const availableCategories = useMemo(() =>
        categories.filter(c => c.Tipo === 'Despesa' || c.Tipo === 'Ambos')
            .sort((a, b) => a.Nome_Categoria.localeCompare(b.Nome_Categoria)), [categories]);

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={budget ? 'Editar Orçamento' : 'Novo Orçamento'}
            footer={
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" form="budget-form">Salvar</Button>
                </div>
            }
        >
            <form id="budget-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <Select label="Categoria" id="budget-category" value={category} onChange={(e) => setCategory(e.target.value)} required disabled={!!budget} error={errors.category}>
                        <option value="" disabled>Selecione uma categoria</option>
                        {availableCategories.map(c => (
                            <option key={c.id} value={c.Nome_Categoria}>{c.Nome_Categoria}</option>
                        ))}
                    </Select>
                    {!!budget && <p className="text-xs text-gray-400 mt-1">A categoria não pode ser alterada na edição.</p>}
                </div>
                <Input
                    label="Limite Mensal (R$)"
                    id="budget-limit"
                    type="number" value={limit} onChange={(e) => setLimit(e.target.value)}
                    required min="0.01" step="0.01" placeholder="Ex: 500.00" error={errors.limit}
                />
            </form>
        </Modal>
    );
}

// MappingRuleModal removed from here and extracted to src/components/modals/

interface ImportConfigModalProps {
    config: ImportConfig | null;
    onClose: () => void;
    onSave: (config: Omit<ImportConfig, 'id'>) => void;
    onOpenCreateAccount: () => void;
    onOpenEditAccount: (accountId: string) => void;
    lastCreatedAccountId: string | null;
}

const ImportConfigModal: React.FC<ImportConfigModalProps> = ({ config, onClose, onSave, onOpenCreateAccount, onOpenEditAccount, lastCreatedAccountId }) => {
    const { accounts } = useAppStore();
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [formState, setFormState] = useState<Omit<ImportConfig, 'id'>>({
        Nome_Fonte: '',
        Tipo_Fonte: 'Conta Corrente',
        Fonte_Manual: false,
        Tem_Cabecalho: true,
        Linhas_Ignorar_Inicio: 0,
        Coluna_Data: '',
        Coluna_Descricao_1: '',
        Coluna_Descricao_2: '',
        Coluna_Parcelas: '',
        Coluna_Valor: '',
        Coluna_Portador: '',
        Texto_Ignorar_Linha_Contendo: [],
        Texto_Parar_Leitura_Contendo: '',
        ID_Conta_Associada: '',
        ...config,
    });

    React.useEffect(() => {
        if (config) {
            setFormState(prev => ({
                ...prev,
                ...config,
                ID_Conta_Associada: config.ID_Conta_Associada || '',
            }));
        }
    }, [config]);

    React.useEffect(() => {
        if (lastCreatedAccountId) {
            setFormState(prev => ({ ...prev, ID_Conta_Associada: lastCreatedAccountId }));
        }
    }, [lastCreatedAccountId]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        setFormState(prev => ({
            ...prev,
            [name]: value,
        }));
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (formState.Nome_Fonte.trim() === '') newErrors.Nome_Fonte = 'O nome da configuração é obrigatório.';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validate()) {
            const payload = {
                ...formState,
                ID_Conta_Associada: formState.ID_Conta_Associada === '' ? null : formState.ID_Conta_Associada
            };
            onSave(payload);
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={config ? 'Editar Configuração' : 'Nova Configuração'}
            className="max-w-md"
            footer={
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" form="import-config-form">Salvar Alterações</Button>
                </div>
            }
        >
            <form id="import-config-form" onSubmit={handleSubmit} className="space-y-6">
                <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-md">
                    <p className="text-sm text-blue-200">
                        ℹ️ <strong>Dica:</strong> Para alterar o mapeamento das colunas (quais campos representam Data, Valor, etc.), faça uma nova importação na aba <strong>Importar Extrato</strong> e escolha "Atualizar Existente" ao final.
                    </p>
                </div>

                <div className="space-y-4">
                    <Input
                        label="Nome da Configuração"
                        name="Nome_Fonte"
                        value={formState.Nome_Fonte}
                        onChange={handleChange}
                        required
                        placeholder="Ex: Cartão Nubank"
                        error={errors.Nome_Fonte}
                    />

                    <Select label="Tipo da Fonte" name="Tipo_Fonte" value={formState.Tipo_Fonte} onChange={handleChange}>
                        <option value="Conta Corrente">Conta Corrente</option>
                        <option value="Poupança">Poupança</option>
                        <option value="Investimento">Investimento</option>
                        <option value="Cartão de Crédito">Cartão de Crédito</option>
                        <option value="Cartão Alimentação">Cartão Alimentação</option>
                        <option value="Outro">Outro</option>
                    </Select>

                    <div className="flex items-end gap-2">
                        <div className="flex-grow">
                            <Select
                                label="Conta Associada (Opcional)"
                                name="ID_Conta_Associada"
                                value={formState.ID_Conta_Associada || ''}
                                onChange={handleChange}
                                helpText="Associe uma conta para vincular lançamentos automaticamente."
                            >
                                <option value="">Nenhuma</option>
                                {accounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>{acc.Nome_Conta}</option>
                                ))}
                            </Select>
                        </div>
                        <Button type="button" onClick={onOpenCreateAccount} className="mb-1" variant="secondary" title="Criar Nova Conta">+</Button>
                    </div>
                </div>
            </form>
        </Modal>
    );
}

const BackupCard: React.FC = () => {
    // Pega o estado completo da aplicação, incluindo todas as listas de dados.
    const { transactions, categories, budgets, mappingRules, importConfigs } = useAppStore();

    const handleDownloadBackup = () => {
        const backupData = {
            transactions,
            categories,
            budgets,
            mappingRules,
            importConfigs,
        };
        // Converte todo o estado para uma string JSON formatada.
        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `personal-finance-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click(); // Simula o clique para iniciar o download.
        document.body.removeChild(link); // Limpa o link do corpo do documento.
        URL.revokeObjectURL(url); // Libera a memória do navegador.
    };

    return (
        <Card title="Backup e Restauração" className="mt-6">
            <p className="text-gray-300 mb-4">Baixe um arquivo de backup com todos os seus dados. Guarde-o em um local seguro.</p>
            <Button onClick={handleDownloadBackup} className="w-full">Baixar Backup Completo</Button>
        </Card>
    );
};

export default SettingsView;
