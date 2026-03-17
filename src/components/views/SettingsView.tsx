
import React, { useState, useCallback, useMemo } from 'react';
import Card from '../ui/Card';
import { useAppStore } from '../../hooks/useAppStore';
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
import { ChevronLeftIcon, ChevronRightIcon } from '../ui/icons';
import { TourButton } from '../TourButton';

const SettingsView: React.FC = () => {
    const { categories, budgets, mappingRules, importConfigs, importLogs, assets, fetchAssets, addAsset, updateAsset, deleteAsset, addCategory, updateCategory, deleteCategory, addBudget, updateBudget, deleteBudget, addMappingRule, updateMappingRule, deleteMappingRule, addImportConfig, updateImportConfig, deleteImportConfig, deleteImportLog, addAccount, updateAccount, deleteAccount, accounts, user, transactions, deleteTransactionsByOrigin, reApplyAllRules, findDuplicateRules, isPremium, setCurrentView } = useAppStore();

    const [isCategoryModalOpen, setCategoryModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);

    // Family Plan Integration
    const [isInviteModalOpen, setInviteModalOpen] = useState(false);
    const [familyMembers, setFamilyMembers] = useState<any[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(false);


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

    const handleSavePin = () => {
        if (appPin.length === 4 && /^\d+$/.test(appPin)) {
            localStorage.setItem('finelo_app_pin', appPin);
            setPinEnabled(true);
            alert('PIN salvo com sucesso! O aplicativo será bloqueado ao iniciar.');
        } else {
            alert('O PIN deve conter exatamente 4 dígitos numéricos.');
        }
    };

    const handleRemovePin = () => {
        localStorage.removeItem('finelo_app_pin');
        setAppPin('');
        setPinEnabled(false);
        alert('PIN removido. O aplicativo iniciará normalmente sem bloqueio.');
    };

    // Load on mount
    React.useEffect(() => {
        fetchFamilyMembers();
    }, []);

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

    // State for Import Log Details Modal
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [selectedLogDetails, setSelectedLogDetails] = useState<{ fileName: string, ignoredDetails: any[], importedDetails: any[] } | null>(null);

    const handleSaveAsset = async (assetData: Omit<Asset, 'id' | 'user_id' | 'updated_at'>) => {
        if (editingAsset) {
            await updateAsset({ ...editingAsset, ...assetData });
            alert(`Ativo "${editingAsset.name}" atualizado com sucesso!`);
        } else {
            await addAsset(assetData);
            alert(`Ativo "${assetData.name}" adicionado com sucesso!`);
        }
        setAssetModalOpen(false);
        setEditingAsset(null);
    };

    const handleSaveAccount = async (accountData: Omit<Account, 'id' | 'user_id'>) => {
        if (editingAccount) {
            await updateAccount({ ...editingAccount, ...accountData });
            alert(`Conta "${editingAccount.Nome_Conta}" atualizada com sucesso!`);
        } else {
            const newAccount = await addAccount(accountData);
            if (newAccount) {
                alert(`Conta "${newAccount.Nome_Conta}" criada com sucesso!`);
                setLastCreatedAccountId(newAccount.id);
            }
        }
        setAccountModalOpen(false);
        setEditingAccount(null);
    };

    const handleSaveCategory = async (categoryData: Omit<Category, 'id'>) => {
        if (editingCategory) {
            await updateCategory({ ...editingCategory, ...categoryData });
            alert(`Categoria "${categoryData.Nome_Categoria}" atualizada com sucesso!`);
            setEditingCategory(null);
            setCategoryModalOpen(false);
        } else {
            const result = await addCategory(categoryData);
            alert(result.message); // Exibe a mensagem de feedback
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
            alert(`Orçamento para "${budgetData.Categoria}" atualizado com sucesso!`);
        } else {
            await addBudget({ ...budgetData, ano: selectedBudgetYear });
            alert(`Orçamento para "${budgetData.Categoria}" criado com sucesso!`);
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
            alert('Regra de mapeamento atualizada com sucesso!');
        } else {
            await addMappingRule(ruleData);
            alert('Regra de mapeamento criada com sucesso!');
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
            alert(`Configuração "${configData.Nome_Fonte}" atualizada com sucesso!`);
        } else {
            await addImportConfig(configData);
            alert(`Configuração "${configData.Nome_Fonte}" criada com sucesso!`);
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
        Cartao: 'Cartão de Crédito',
        'Cartão Alimentação': 'Cartão Alimentação'
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

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <h1 className="text-3xl font-bold text-light">Configurações</h1>
                <TourButton currentView="settings" />
            </div>

            <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div id="settings-categories">
                        <CrudCard<Category>
                            title="Gerenciar Categorias"
                            data={sortedCategories}
                            headers={['Nome', 'Tipo', 'Invest.', 'Essencial?']}
                            renderRow={(item: Category) => (
                                <>
                                    <td className="px-2 py-3 text-sm break-all max-w-[120px]">{item.Nome_Categoria}</td>
                                    <td className={`px-2 py-3 whitespace-nowrap text-sm font-semibold ${categoryTypeColorMap[item.Tipo]}`}>
                                        {item.Tipo === 'Renda' ? 'Entrada' : item.Tipo === 'Despesa' ? 'Saída' : 'Movimentação'}
                                    </td>
                                    <td className="px-2 py-3 whitespace-nowrap text-sm text-center">
                                        {item.is_investment ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800" title="Investimento">
                                                Sim
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="px-2 py-3 whitespace-nowrap text-sm text-center">
                                        {/* Gasto Essencial (only for Despesa/Ambos and not Investment) */}
                                        {!item.is_investment && (item.Tipo === 'Despesa' || item.Tipo === 'Ambos') ? (
                                            item.is_essential ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800" title="Essencial">
                                                    Sim
                                                </span>
                                            ) : (
                                                <span className="text-gray-400 text-xs">Não</span>
                                            )
                                        ) : (
                                            <span className="text-gray-500 text-xs">-</span>
                                        )}
                                    </td>
                                </>
                            )}
                            onAdd={openNewCategoryModal}
                            onEdit={openEditCategoryModal}
                            onDelete={async (id) => { if (window.confirm('Tem certeza?')) await deleteCategory(id) }}
                            searchKeys={['Nome_Categoria', 'Tipo']}
                            searchPlaceholder="Buscar por nome ou tipo..."
                        />
                    </div>
                    <div id="settings-budgets">
                        <CrudCard<Budget & { id: string }>
                            title="Gerenciar Orçamentos"
                            data={budgetsWithId}
                            headers={['Categoria', 'Limite Mensal']}
                            renderRow={(item: Budget) => (
                                <>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm">{item.Categoria}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.Valor_Limite_Mensal)}</td>
                                </>
                            )}
                            onAdd={openNewBudgetModal}
                            onEdit={openEditBudgetModal}
                            onDelete={async (id) => { if (window.confirm('Tem certeza?')) await deleteBudget(id) }}
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
                </div>

                <div id="settings-rules" className="lg:col-span-2">
                    <CrudCard<MappingRule>
                        title="Gerenciar Regras de Mapeamento"
                        data={mappingRules} headers={['Texto na Descrição', 'Nome Sugerido', 'Categoria Sugerida']}
                        renderRow={(item: MappingRule) => (
                            <>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{item.Texto_Contido_Descricao}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{item.Nome_Fantasia_Sugerido}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{item.Categoria_Sugerida}</td>
                            </>
                        )}
                        onAdd={openNewMappingRuleModal}
                        onEdit={openEditMappingRuleModal}
                        onDelete={async (id) => { if (window.confirm('Tem certeza?')) await deleteMappingRule(id) }}
                        searchKeys={['Texto_Contido_Descricao', 'Nome_Fantasia_Sugerido', 'Categoria_Sugerida']}
                        searchPlaceholder="Buscar por texto, nome ou categoria..."
                        footer={
                            <div className="mt-4 border-t border-slate-700 pt-4 flex gap-4">
                                <Button
                                    variant="secondary"
                                    onClick={async () => {
                                        if (window.confirm('Isso irá verificar TODAS as transações e aplicar as regras correspondentes. Pode levar alguns instantes. Deseja continuar?')) {
                                            await reApplyAllRules();
                                            alert('Regras reaplicadas com sucesso!');
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
                                            alert('Nenhuma regra duplicada encontrada.');
                                            return;
                                        }

                                        const message = duplicates.map(group => {
                                            const text = group[0].Texto_Contido_Descricao;
                                            return `- "${text}" (${group.length} ocorrências)`;
                                        }).join('\n');

                                        alert(`⚠️ Regras duplicadas encontradas:\n\n${message}\n\nPor favor, remova as duplicatas manualmente na lista acima.`);
                                    }}
                                    className="w-full sm:w-auto"
                                >
                                    Verificar Duplicatas
                                </Button>
                            </div>
                        }
                    />
                </div>
                <div id="settings-manage-accounts" data-tour="settings-accounts" className="lg:col-span-2 min-h-[100px]">
                    <CrudCard<Account>
                        title="Gerenciar Contas"
                        data={accounts}
                        headers={['Nome', 'Tipo', 'Saldo Inicial']}
                        renderRow={(item) => (
                            <>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{item.Nome_Conta}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{item.Tipo_Conta}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.Saldo_Inicial)}
                                </td>
                            </>
                        )}
                        onAdd={() => { setEditingAccount(null); setAccountModalOpen(true); }}
                        onEdit={(item) => { setEditingAccount(item); setAccountModalOpen(true); }}
                        onDelete={async (id) => {
                            if (window.confirm('Tem certeza? Isso excluirá a conta e TODAS as transações associadas.')) {
                                await deleteAccount(id);
                            }
                        }}
                        searchKeys={['Nome_Conta', 'Tipo_Conta']}
                        searchPlaceholder="Buscar conta..."
                    />
                </div>
                <div id="settings-manage-assets" className="lg:col-span-2">
                    <CrudCard<Asset>
                        title="Patrimônio (Ativos Fixos)"
                        data={assets}
                        headers={['Nome', 'Tipo / Status', 'Valor Bruto', 'Dívida', 'P. Líquido (Equity)']}
                        renderRow={(item) => (
                            <>
                                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">{item.name}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-gray-400">
                                            {item.type === 'car' ? 'Veículo' : item.type === 'property' ? 'Imóvel' : 'Outro'}
                                        </span>
                                        {item.is_financed && (
                                            <div className="flex items-center gap-2">
                                                <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden" title={`${item.paid_installments || 0}/${item.total_installments || 0} parcelas`}>
                                                    <div 
                                                        className="h-full bg-highlight" 
                                                        style={{ width: `${((item.paid_installments || 0) / (item.total_installments || 1)) * 100}%` }}
                                                    ></div>
                                                </div>
                                                <span className="text-[10px] text-highlight font-bold uppercase">Financiado</span>
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.value)}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-danger font-medium">
                                    {item.is_financed ? (
                                        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.remaining_balance || 0)
                                    ) : (
                                        <span className="text-gray-600">-</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-accent">
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.value - (item.is_financed ? (item.remaining_balance || 0) : 0))}
                                </td>
                            </>
                        )}
                        onAdd={() => { setEditingAsset(null); setAssetModalOpen(true); }}
                        onEdit={(item) => { setEditingAsset(item); setAssetModalOpen(true); }}
                        onDelete={async (id) => {
                            if (window.confirm('Excluir este ativo do seu patrimônio?')) {
                                await deleteAsset(id);
                            }
                        }}
                        searchKeys={['name', 'type']}
                        searchPlaceholder="Buscar por nome ou tipo..."
                    />
                </div>

                <div id="settings-configs" className="lg:col-span-2">
                    <CrudCard<ImportConfig>
                        title="Gerenciar Configurações de Importação"
                        data={importConfigs} headers={['Fonte', 'Tipo']}
                        renderRow={(item: ImportConfig) => (
                            <>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{item.Nome_Fonte}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{importConfigTypeMap[item.Tipo_Fonte]}</td>
                            </>
                        )}
                        onAdd={openNewImportConfigModal}
                        onEdit={openEditImportConfigModal}
                        onDelete={async (id) => {
                            const config = importConfigs.find(c => c.id === id);
                            if (!config) return;

                            const confirmConfig = window.confirm(`Tem certeza que deseja remover a configuração para "${config.Nome_Fonte}"?`);
                            if (!confirmConfig) return;

                            await deleteImportConfig(id);

                            if (config.ID_Conta_Associada) {
                                const account = accounts.find(a => a.id === config.ID_Conta_Associada);
                                const accountName = account ? account.Nome_Conta : 'a conta associada';

                                if (window.confirm(`Deseja, TAMBÉM, excluir ${accountName} e todas as transações associadas?\n\nIsso limpará completamente os dados vindos desta fonte.`)) {
                                    // Deletar a conta. Assumimos que o banco está configurado com CASCADE ou o store limpa as transações.
                                    // Mas por segurança, vamos deletar as transações dessa conta antes.
                                    // Não temos ID da conta aqui diretamente no deleteAccount do context de transações, mas o deleteAccount da store deve cuidar disso ou o banco.
                                    // Vamos confiar no deleteAccount da store por enquanto, mas seria bom garantir.
                                    if (config.ID_Conta_Associada) {
                                        await deleteAccount(config.ID_Conta_Associada);
                                        alert('Conta e transações excluídas.');
                                    }
                                }
                            }
                        }}
                        searchKeys={['Nome_Fonte', 'Tipo_Fonte']}
                        searchPlaceholder="Buscar por fonte ou tipo..."
                    />
                </div>

                {/* Family Plan Section */}
                <div id="settings-family" className="lg:col-span-2">
                    <Card className="flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <div className='flex items-center gap-2'>
                                <h2 className="text-xl font-bold text-light">Plano Família (Compartilhamento)</h2>
                                <span className="bg-accent/20 text-accent text-xs px-2 py-0.5 rounded-full border border-accent/50">Novo</span>
                            </div>
                            {/* Premium Lock */}
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
                                </div>
                            ) : (
                                <ul className="space-y-2">
                                    {familyMembers.map(member => {
                                        const isReceivedInvite = member.member_email?.toLowerCase().trim() === user?.email?.toLowerCase().trim();
                                        const displayName = isReceivedInvite ? `Responsável: ${member.owner_email}` : member.member_email;

                                        return (
                                            <li key={member.id} className="flex justify-between items-center bg-slate-800 p-3 rounded">
                                                <span className="text-sm font-medium text-white">{displayName}</span>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${member.status === 'accepted' ? 'text-green-400 bg-green-900/30' :
                                                        member.status === 'declined' ? 'text-danger bg-red-900/30' :
                                                            'text-yellow-400 bg-yellow-900/30'
                                                        }`}>
                                                        {member.status === 'accepted' ? 'Aceito' :
                                                            member.status === 'declined' ? 'Recusado' :
                                                                'Pendente'}
                                                    </span>
                                                    <button
                                                        onClick={async () => {
                                                            const msg = isReceivedInvite
                                                                ? `Sair do plano compartilhado de ${member.owner_email}?`
                                                                : `Remover acesso de ${member.member_email}?`;
                                                            if (!window.confirm(msg)) return;
                                                            const { supabase } = await import('../../supabaseClient');
                                                            await supabase.from('family_members').delete().eq('id', member.id);
                                                            fetchFamilyMembers();
                                                            // Se eu sou o convidado e estou saindo, recarregar assinatura
                                                            if (isReceivedInvite) {
                                                                useAppStore.getState().fetchSubscription();
                                                            }
                                                        }}
                                                        className="text-danger hover:text-red-400 text-xs font-bold px-2 py-1"
                                                    >
                                                        {isReceivedInvite ? 'Sair' : 'Remover'}
                                                    </button>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </Card>
                </div>

                {/* Import Logs */}
                <div id="settings-logs" className="lg:col-span-2">
                    <CrudCard<ImportLog>
                        title="Histórico de Importações"
                        data={importLogs}
                        headers={['Arquivo', 'Data da Importação', 'Total', 'Importados', 'Ignorados']}
                        renderRow={(item) => (
                            <>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{item.file_name}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{new Date(item.import_date).toLocaleString()}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{item.total_transactions}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-accent">{item.imported_count}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-danger">{item.ignored_count}</td>
                            </>
                        )}
                        onAdd={() => { }}
                        onEdit={(item) => {
                            if (item.ignored_count > 0 || item.imported_count > 0) {
                                setSelectedLogDetails({
                                    fileName: item.file_name,
                                    ignoredDetails: item.ignored_details || [],
                                    importedDetails: item.imported_details || []
                                });
                                setIsDetailsModalOpen(true);
                            } else {
                                alert('Não há transações nesta importação para visualizar.');
                            }
                        }}
                        onDelete={async (id) => {
                            const log = importLogs.find(l => l.id === id);
                            if (log && window.confirm(`ATENÇÃO: Isso excluirá o registro de importação "${log.file_name}" E TODAS AS TRANSAÇÕES associadas a ele. Deseja continuar?`)) {
                                await deleteImportLog(id, log.file_name);
                            }
                        }}
                        searchKeys={['file_name']}
                        searchPlaceholder="Buscar por nome do arquivo..."
                        hideAddButton={true}
                        hideEditButton={false} // Show edit button to view details
                        editLabel="Exibir" // Custom label for the action button
                        footer={
                            <div className="mt-4 border-t border-slate-700 pt-4">
                                <Button
                                    variant="secondary"
                                    onClick={async () => {
                                        if (window.confirm('Isso irá verificar suas transações existentes e criar logs para importações antigas que não estão listadas aqui. Deseja continuar?')) {
                                            const { syncLegacyImportLogs } = useAppStore.getState();
                                            await syncLegacyImportLogs();
                                        }
                                    }}
                                    className="w-full sm:w-auto"
                                >
                                    Sincronizar Histórico Antigo
                                </Button>
                            </div>
                        }
                    />
                </div>
            </div>
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
                />
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

const CrudCard = <T extends { id: string },>({ title, data, headers, renderRow, onAdd, onEdit, onDelete, searchKeys = [], searchPlaceholder = 'Buscar...', customBody, hideAddButton = false, hideEditButton = false, footer, extraHeader, editLabel = 'Editar' }: CrudCardProps<T>) => {
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

                        <div className="hidden lg:block bg-primary rounded-lg shadow-inner overflow-x-auto">
                            <table className="min-w-[800px] sm:min-w-full divide-y divide-secondary">
                                <thead className="bg-slate-700">
                                    <tr>
                                        {headers.map(header => <th key={header} scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{header}</th>)}
                                        <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-secondary">
                                    {paginatedData.map(item => (
                                        <tr key={item.id}>
                                            {renderRow(item)}
                                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-4">
                                                {!hideEditButton && <button className="text-highlight hover:text-sky-300 font-semibold" onClick={() => onEdit(item)}>{editLabel}</button>}
                                                <button className="text-danger hover:text-red-400 font-semibold" onClick={() => onDelete(item.id)}>Excluir</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {paginatedData.length === 0 && <p className="text-center text-gray-400 py-8">Nenhum item encontrado.</p>}
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
        Tipo_Fonte: 'Conta',
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
                        <option value="Conta">Conta Corrente</option>
                        <option value="Cartao">Cartão de Crédito</option>
                        <option value="Cartão Alimentação">Cartão Alimentação</option>
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
