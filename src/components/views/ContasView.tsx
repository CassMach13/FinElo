import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { Account } from '../../types';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import AccountModal from './AccountModal';
import { formatCurrency } from '../../utils/formatters';

const ContasView: React.FC = () => {
    const { accounts, transactions, getAccountsWithCalculatedBalance, addAccount, updateAccount, deleteAccount } = useAppStore();
    const [isAccountModalOpen, setAccountModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<Account | null>(null);

    // LOG DE DETETIVE: O que o componente está vendo?
    console.log('%c[ContasView Render] Array de contas recebido do store:', 'color: #00ccff', accounts);

    // Usamos o seletor para obter as contas já com o saldo calculado
    const accountsWithBalance = useMemo(() => getAccountsWithCalculatedBalance(), [accounts, transactions, getAccountsWithCalculatedBalance]);

    const handleSaveAccount = async (accountData: Omit<Account, 'id' | 'user_id'>) => {
        if (editingAccount) {
            await updateAccount({ ...editingAccount, ...accountData });
            alert(`Conta "${editingAccount.Nome_Conta}" atualizada com sucesso!`);
        } else {
            console.log('%c[ContasView] Enviando dados para o store via addAccount...', 'color: #ff9900', accountData);
            await addAccount(accountData);
            alert(`Conta "${accountData.Nome_Conta}" criada com sucesso!`);
        }
        setEditingAccount(null);
        setAccountModalOpen(false);
    };

    const openEditAccountModal = (account: Account) => {
        setEditingAccount(account);
        setAccountModalOpen(true);
    };

    const openNewAccountModal = () => {
        setEditingAccount(null);
        setAccountModalOpen(true);
    };

    const handleArchiveAccount = async (id: string, isArchived: boolean) => {
        if (window.confirm(isArchived ? 'Deseja desarquivar esta conta? Ela voltará a aparecer nos cards e formulários.' : 'Deseja arquivar esta conta? O histórico será mantido, mas ela não aparecerá mais nos resumos e formulários de nova transação.')) {
            const { archiveAccount } = useAppStore.getState();
            await archiveAccount(id, isArchived);
        }
    };

    const handleDeleteAccount = async (id: string) => {
        if (window.confirm('Tem certeza que deseja excluir esta conta? Isso só é possível se não houver transações.')) {
            try {
                await deleteAccount(id);
            } catch (err: any) {
                if (err.message === 'has_transactions') {
                    alert('Não é possível excluir esta conta pois ela possui transações vinculadas.\nPara ocultá-la sem perder o histórico, use a opção "Arquivar".');
                } else {
                    alert('Erro ao excluir conta.');
                }
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-light">Minhas Contas</h1>
                <Button onClick={openNewAccountModal}>Adicionar Conta</Button>
            </div>

            <CrudCard<Account>
                title="Contas Cadastradas"
                data={accountsWithBalance}
                headers={['Nome da Conta', 'Tipo', 'Saldo Inicial / Limite', 'Saldo Atual / Fatura']}
                renderRow={(item) => (
                    <>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-light flex items-center gap-2">
                            {item.Nome_Conta}
                            {item.is_archived && <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider" title="Conta arquivada e oculta dos painéis">📦 Arquivada</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {item.Tipo_Conta}
                            {item.Tipo_Conta === 'Cartão de Crédito' && (item.dia_fechamento || item.dia_vencimento) && (
                                <div className="text-[10px] text-gray-500 mt-0.5">
                                    {item.dia_fechamento ? `Fecha dia ${item.dia_fechamento}` : 'Ciclo: Mês atual'}
                                    {item.dia_vencimento ? ` · Vence dia ${item.dia_vencimento}` : ''}
                                </div>
                            )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                            {item.Tipo_Conta === 'Cartão de Crédito' && item.limite_credito ? (
                                <span className="text-indigo-300 font-semibold">{formatCurrency(item.limite_credito)}</span>
                            ) : (
                                <>{formatCurrency(item.Saldo_Inicial)} <span className="text-xs">em {new Date(item.Data_Saldo_Inicial).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span></>
                            )}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold ${item.is_archived ? 'text-gray-500 line-through' : 'text-light'}`}>
                            {formatCurrency(item.Saldo_Atual_Calculado ?? 0)}
                            {item.Tipo_Conta === 'Cartão de Crédito' && item.limite_credito && (
                                <div className="text-[10px] text-gray-500 font-normal mt-0.5">
                                    {formatCurrency(Math.max((item.limite_credito || 0) + (item.Saldo_Atual_Calculado ?? 0), 0))} disponível
                                </div>
                            )}
                        </td>
                    </>
                )}
                onAdd={openNewAccountModal}
                onEdit={openEditAccountModal}
                onDelete={handleDeleteAccount}
                onArchive={handleArchiveAccount}
                searchKeys={['Nome_Conta', 'Tipo_Conta']}
                searchPlaceholder="Buscar por nome ou tipo..."
                hideAddButton={true} // O botão principal da tela já faz isso
            />

            {isAccountModalOpen && (
                <AccountModal
                    account={editingAccount}
                    onClose={() => { setAccountModalOpen(false); setEditingAccount(null); }}
                    onSave={handleSaveAccount}
                />
            )}

            {/* Mobile Floating Action Button (FAB) */}
            <button
                onClick={openNewAccountModal}
                className="fixed lg:hidden bottom-[80px] right-6 w-14 h-14 bg-highlight hover:bg-sky-400 text-white rounded-full shadow-[0_4px_14px_rgba(56,189,248,0.5)] flex items-center justify-center transition-transform active:scale-95 z-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-primary focus:ring-highlight"
                aria-label="Nova Conta"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
            </button>
        </div>
    );
};

// Componente de Card genérico para CRUD (similar ao de Settings)
interface CrudCardProps<T> {
    title: string;
    data: T[];
    headers: string[];
    renderRow: (item: T) => React.ReactNode;
    onAdd: () => void;
    onEdit: (item: T) => void;
    onDelete: (id: string) => void;
    onArchive?: (id: string, isArchived: boolean) => void;
    searchKeys?: (keyof T)[];
    searchPlaceholder?: string;
    hideAddButton?: boolean;
}

const CrudCard = <T extends { id: string, is_archived?: boolean },>({ title, data, headers, renderRow, onAdd, onEdit, onDelete, onArchive, searchKeys = [], searchPlaceholder = 'Buscar...', hideAddButton = false }: CrudCardProps<T>) => {
    const [searchTerm, setSearchTerm] = useState('');
    const filteredData = useMemo(() => {
        if (!searchTerm) return data;
        return data.filter(item =>
            searchKeys.some(key =>
                String(item[key]).toLowerCase().includes(searchTerm.toLowerCase())
            )
        );
    }, [data, searchTerm, searchKeys]);

    return (
        <Card className="flex flex-col">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-light">{title}</h2>
                {!hideAddButton && <Button onClick={onAdd}>Adicionar Novo</Button>}
            </div>
            <Input
                type="text"
                placeholder={searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="mb-4"
            />
            <div className="flex-grow overflow-y-auto">
                {/* Mobile Card View */}
                <div className="block lg:hidden space-y-3 mb-6">
                    {filteredData.map(item => (
                        <div key={item.id} className="bg-secondary p-4 rounded-xl shadow-md border border-slate-700/50 flex flex-col gap-2 relative">
                            {headers.map((header, idx) => (
                                <div key={header} className="flex justify-between items-center text-sm border-b border-slate-700/30 pb-1 last:border-0 last:pb-0">
                                    <span className="text-gray-500 font-medium text-xs">{header}</span>
                                    {/* We use a React fragment wrapper to capture the specific td content from renderRow since it returns <td> elements */}
                                    <span className="text-white font-semibold text-right max-w-[60%] truncate">
                                        {React.Children.toArray((renderRow(item) as any).props?.children || renderRow(item))[idx] || String(Object.values(item)[idx + 1] || '-')}
                                    </span>
                                </div>
                            ))}
                            <div className="flex justify-end gap-3 mt-2 pt-2 border-t border-slate-700/30">
                                {onArchive && (
                                    <button className="text-orange-400 hover:text-orange-300 font-semibold p-1" onClick={() => onArchive(item.id, !item.is_archived)}>
                                        {item.is_archived ? 'Desarquivar' : 'Arquivar'}
                                    </button>
                                )}
                                <button className="text-highlight hover:text-sky-300 font-semibold p-1" onClick={() => onEdit(item)}>
                                    Editar
                                </button>
                                <button className="text-danger hover:text-red-400 font-semibold p-1" onClick={() => onDelete(item.id)}>
                                    Excluir
                                </button>
                            </div>
                        </div>
                    ))}
                    {filteredData.length === 0 && <p className="text-center text-gray-400 py-8">Nenhum item encontrado.</p>}
                </div>

                {/* Desktop Table View */}
                <div className="hidden lg:block bg-primary rounded-lg shadow-inner overflow-x-auto">
                    <table className="min-w-[800px] sm:min-w-full divide-y divide-secondary">
                        <thead className="bg-slate-700">
                            <tr>
                                {headers.map(header => <th key={header} scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{header}</th>)}
                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-secondary">
                            {filteredData.map(item => (
                                <tr key={item.id}>
                                    {renderRow(item)}
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-4">
                                        {onArchive && (
                                            <button className="text-orange-400 hover:text-orange-300 font-semibold" onClick={() => onArchive(item.id, !item.is_archived)}>
                                                {item.is_archived ? 'Desarquivar' : 'Arquivar'}
                                            </button>
                                        )}
                                        <button className="text-highlight hover:text-sky-300 font-semibold" onClick={() => onEdit(item)}>Editar</button>
                                        <button className="text-danger hover:text-red-400 font-semibold" onClick={() => onDelete(item.id)}>Excluir</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredData.length === 0 && <p className="text-center text-gray-400 py-8">Nenhum item encontrado.</p>}
                </div>
            </div>
        </Card>
    );
};

export default ContasView;