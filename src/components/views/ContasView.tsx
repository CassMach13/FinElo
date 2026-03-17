import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { Account } from '../../types';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import AccountModal from './AccountModal';

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

    const handleDeleteAccount = async (id: string) => {
        if (window.confirm('Tem certeza que deseja excluir esta conta? Todas as transações associadas perderão o vínculo.')) {
            await deleteAccount(id);
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
                headers={['Nome da Conta', 'Tipo', 'Saldo Inicial', 'Saldo Atual']}
                renderRow={(item) => (
                    <>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-light">{item.Nome_Conta}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{item.Tipo_Conta}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.Saldo_Inicial)} <span className="text-xs">em {new Date(item.Data_Saldo_Inicial).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span></td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-light">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.Saldo_Atual_Calculado ?? 0)}</td>
                    </>
                )}
                onAdd={openNewAccountModal}
                onEdit={openEditAccountModal}
                onDelete={handleDeleteAccount}
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
    searchKeys?: (keyof T)[];
    searchPlaceholder?: string;
    hideAddButton?: boolean;
}

const CrudCard = <T extends { id: string },>({ title, data, headers, renderRow, onAdd, onEdit, onDelete, searchKeys = [], searchPlaceholder = 'Buscar...', hideAddButton = false }: CrudCardProps<T>) => {
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