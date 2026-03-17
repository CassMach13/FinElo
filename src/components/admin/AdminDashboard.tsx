import React, { useEffect } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import Card from '../ui/Card';

const AdminDashboard: React.FC = () => {
    const { fetchAdminMetrics, adminMetrics, isLoading } = useAppStore();

    useEffect(() => {
        fetchAdminMetrics();
    }, [fetchAdminMetrics]);

    if (isLoading || !adminMetrics) {
        return (
            <div className="flex h-full items-center justify-center animate-pulse text-gray-400">
                Carregando métricas...
            </div>
        );
    }

    return (
        <div className="space-y-6 flex-1 min-h-0 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="flex flex-col bg-slate-800/50 border-white/5">
                    <h3 className="text-gray-400 text-sm font-medium">Total de Usuários</h3>
                    <p className="text-3xl font-bold text-white mt-2">{adminMetrics.total_users}</p>
                </Card>
                <Card className="flex flex-col bg-slate-800/50 border-white/5">
                    <h3 className="text-gray-400 text-sm font-medium">Novos Cadastros (30d)</h3>
                    <p className="text-3xl font-bold text-green-400 mt-2">+{adminMetrics.new_users_30_days}</p>
                </Card>
                <Card className="flex flex-col bg-slate-800/50 border-white/5">
                    <h3 className="text-gray-400 text-sm font-medium">Assinantes Anuais</h3>
                    <p className="text-3xl font-bold text-white mt-2">{adminMetrics.yearly_users}</p>
                </Card>
                <Card className="flex flex-col bg-slate-800/50 border-white/5">
                    <h3 className="text-gray-400 text-sm font-medium">Assinantes Mensais</h3>
                    <p className="text-3xl font-bold text-white mt-2">{adminMetrics.monthly_users}</p>
                </Card>
            </div>
        </div>
    );
};

export default AdminDashboard;
