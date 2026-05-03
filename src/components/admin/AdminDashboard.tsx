import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import Card from '../ui/Card';
import { AdminCrmUser } from '../../types';

type SortKey = keyof AdminCrmUser;

const AdminDashboard: React.FC = () => {
    const { fetchAdminMetrics, adminMetrics, isLoading } = useAppStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
        key: 'last_sign_in_at',
        direction: 'asc' // O default é asc para os mais antigas vir primeiro
    });

    useEffect(() => {
        fetchAdminMetrics();
    }, [fetchAdminMetrics]);

    if (isLoading && (!adminMetrics)) {
        return (
            <div className="flex h-full items-center justify-center animate-pulse text-gray-400">
                Carregando métricas do CRM...
            </div>
        );
    }

    const handleCopyEmail = (email: string, id: string) => {
        navigator.clipboard.writeText(email);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleSort = (key: SortKey) => {
        setSortConfig((current) => ({
            key,
            direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const filteredUsers = (adminMetrics?.crm_users || []).filter(u => 
        !searchTerm || u.email.toLowerCase().includes(searchTerm.toLowerCase().trim()) || (u.full_name && u.full_name.toLowerCase().includes(searchTerm.toLowerCase().trim()))
    );

    const sortedUsers = [...filteredUsers].sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];

        if (sortConfig.key === 'last_sign_in_at' || sortConfig.key === 'created_at') {
            // Se for nulo conta como 0 (o começo dos tempos), assim eles ficam topo do ASC (mais tempo sem acessar).
            const aDate = aValue ? new Date(aValue as string).getTime() : 0;
            const bDate = bValue ? new Date(bValue as string).getTime() : 0;
            return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate;
        }

        const strA = (aValue || '').toString().toLowerCase();
        const strB = (bValue || '').toString().toLowerCase();
        return sortConfig.direction === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });

    const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
        if (sortConfig.key !== columnKey) return <span className="text-slate-600 opacity-0 group-hover:opacity-50 ml-1 transition-opacity">↕</span>;
        return <span className="text-cyan-400 ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
    };

    return (
        <div className="space-y-6 flex-1 min-h-0 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="flex flex-col bg-slate-800/50 border-white/5">
                    <h3 className="text-gray-400 text-sm font-medium">Total de Usuários</h3>
                    <p className="text-3xl font-bold text-white mt-2">{adminMetrics?.total_users || 0}</p>
                </Card>
                <Card className="flex flex-col bg-slate-800/50 border-white/5">
                    <h3 className="text-gray-400 text-sm font-medium">Novos Cadastros (30d)</h3>
                    <p className="text-3xl font-bold text-green-400 mt-2">+{adminMetrics?.new_users_30_days || 0}</p>
                </Card>
                <Card className="flex flex-col bg-slate-800/50 border-white/5">
                    <h3 className="text-gray-400 text-sm font-medium">Assinantes Anuais</h3>
                    <p className="text-3xl font-bold text-white mt-2">{adminMetrics?.yearly_users || 0}</p>
                </Card>
                <Card className="flex flex-col bg-slate-800/50 border-white/5">
                    <h3 className="text-gray-400 text-sm font-medium">Assinantes Mensais</h3>
                    <p className="text-3xl font-bold text-white mt-2">{adminMetrics?.monthly_users || 0}</p>
                </Card>
            </div>

            {/* CRM Table */}
            <div className="bg-secondary/30 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden flex flex-col">
                <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <h3 className="text-lg font-bold text-white">Lista de Clientes (CRM)</h3>
                    <div className="relative w-full sm:w-64">
                        <input
                            type="text"
                            placeholder="Buscar por e-mail..."
                            className="w-full bg-slate-800/50 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:border-purple-500 outline-none transition-colors"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-400">
                        <thead className="bg-slate-900/50 text-xs uppercase text-gray-400 font-semibold border-b border-white/5">
                            <tr>
                                <th scope="col" className="px-6 py-3 cursor-pointer group hover:text-white transition-colors" onClick={() => handleSort('full_name')}>
                                    <div className="flex items-center">Usuário <SortIcon columnKey="full_name"/></div>
                                </th>
                                <th scope="col" className="px-6 py-3 cursor-pointer group hover:text-white transition-colors" onClick={() => handleSort('plan_type')}>
                                    <div className="flex items-center">Plano Vigente <SortIcon columnKey="plan_type"/></div>
                                </th>
                                <th scope="col" className="px-6 py-3 cursor-pointer group hover:text-white transition-colors" onClick={() => handleSort('created_at')}>
                                    <div className="flex items-center">Data de Cadastro <SortIcon columnKey="created_at"/></div>
                                </th>
                                <th scope="col" className="px-6 py-3 cursor-pointer group hover:text-white transition-colors" onClick={() => handleSort('last_sign_in_at')}>
                                    <div className="flex items-center text-cyan-500 font-bold">Último Acesso <SortIcon columnKey="last_sign_in_at"/></div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {sortedUsers.length > 0 ? (
                                sortedUsers.map((user) => (
                                    <tr key={user.id} className="hover:bg-slate-800/30 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-semibold text-slate-200">{user.full_name || 'Usuário sem nome'}</div>
                                            <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                                                <span>{user.email}</span>
                                                <button 
                                                    onClick={() => handleCopyEmail(user.email, user.id)}
                                                    className="p-1 hover:bg-slate-700 rounded transition-colors group/copy relative"
                                                    title="Copiar e-mail"
                                                >
                                                    {copiedId === user.id ? (
                                                        <span className="text-emerald-400 text-xs font-bold">✓ Copiado</span>
                                                    ) : (
                                                        <svg className="w-3.5 h-3.5 text-gray-400 group-hover/copy:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                        </svg>
                                                    )}
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1 items-start">
                                                {user.plan_type === 'lifetime' ? (
                                                    <span className="bg-gradient-to-r from-orange-500/20 to-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                                                        Fundador
                                                    </span>
                                                ) : user.plan_type === 'annual' ? (
                                                    <div className="flex items-center gap-1">
                                                        <span className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                                                            Anual
                                                        </span>
                                                        <span className={`text-[9px] font-bold uppercase ${user.tier === 'wealth' ? 'text-purple-300' : 'text-blue-300'}`}>
                                                            ({user.tier})
                                                        </span>
                                                    </div>
                                                ) : user.plan_type === 'monthly' ? (
                                                    <div className="flex items-center gap-1">
                                                        <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                                                            Mensal
                                                        </span>
                                                        <span className={`text-[9px] font-bold uppercase ${user.tier === 'wealth' ? 'text-purple-300' : 'text-blue-300'}`}>
                                                            ({user.tier})
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="bg-slate-700 px-2 py-0.5 rounded text-[10px] text-gray-400 uppercase">
                                                        Free
                                                    </span>
                                                )}
                                                {user.plan_status && !['active', 'lifetime'].includes(user.plan_status) && (
                                                    <span className="text-[9px] bg-red-500/20 text-red-500 px-1 py-0.5 rounded font-mono">
                                                        {user.plan_status.toUpperCase()}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {new Date(user.created_at).toLocaleDateString('pt-BR')}
                                        </td>
                                        <td className="px-6 py-4">
                                            {user.last_sign_in_at ? (
                                                <span className={`px-2 py-0.5 rounded-full text-xs border ${
                                                    (new Date().getTime() - new Date(user.last_sign_in_at).getTime()) < 3 * 24 * 60 * 60 * 1000 
                                                        ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                                                        : 'bg-slate-800 border-slate-700 text-gray-500'
                                                }`}>
                                                    {new Date(user.last_sign_in_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute:'2-digit' })}
                                                </span>
                                            ) : (
                                                <span className="text-gray-600 italic">Nunca acessou</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                                        Nenhum usuário encontrado na busca.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
