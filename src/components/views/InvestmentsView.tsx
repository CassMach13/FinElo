import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { Investment } from '../../types';
import { investmentService } from '../../services/investmentService';
import InvestmentModal from '../modals/InvestmentModal';
import InvestmentImportModal from '../modals/InvestmentImportModal';

const InvestmentsView: React.FC = () => {
    const { user, isWealth, setCurrentView } = useAppStore();
    const [currentDate, setCurrentDate] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });
    const [investments, setInvestments] = useState<Investment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [editingInvestment, setEditingInvestment] = useState<Investment | null>(null);

    const fetchInvestments = async (date: Date) => {
        setIsLoading(true);
        try {
            const data = await investmentService.getInvestments(date);
            setInvestments(data);
        } catch (error) {
            console.error('Failed to fetch investments:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchInvestments(currentDate);
    }, [currentDate, user]);

    const handlePrevMonth = () => {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    };

    const handleNextMonth = () => {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    };

    if (!isWealth) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center animate-fade-in-up">
                <div className="bg-slate-900/80 backdrop-blur-md border border-purple-500/30 p-10 rounded-3xl shadow-[0_0_40px_rgba(168,85,247,0.15)] max-w-2xl w-full flex flex-col items-center">
                    <div className="h-20 w-20 bg-purple-500/10 rounded-full flex items-center justify-center mb-6">
                        <svg className="w-10 h-10 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    </div>

                    <h2 className="text-3xl font-bold text-white mb-4">
                        Gestão de <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-purple-600">Patrimônio</span>
                    </h2>

                    <p className="text-lg text-gray-300 mb-8 max-w-lg leading-relaxed">
                        Acompanhe ações, fundos e renda fixa de diversas corretoras em um único painel. Rentabilidade, aportes e evolução patrimonial unificada.
                        Exclusivo para o <strong className="text-purple-400">Plano Wealth</strong>.
                    </p>

                    <button
                        onClick={() => setCurrentView('pricing')}
                        className="px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-500/25 hover:-translate-y-1 hover:shadow-purple-500/40 text-lg w-full sm:w-auto"
                    >
                        Conhecer o Plano Wealth
                    </button>
                </div>
            </div>
        );
    }

    const handleCopyPrevious = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            await investmentService.copyFromPreviousMonth(user.id, currentDate);
            await fetchInvestments(currentDate);
        } catch (error) {
            console.error('Failed to copy investments:', error);
            setIsLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja remover este investimento?')) return;
        try {
            await investmentService.deleteInvestment(id);
            setInvestments(investments.filter(i => i.id !== id));
            alert('Investimento removido com sucesso.');
        } catch (error) {
            console.error('Failed to delete investment:', error);
            alert('Erro ao remover investimento. Verifique sua conexão e tente novamente.');
        }
    };

    const handleClearInstitution = async (institution: string) => {
        if (!user) {
            alert('Usuário não identificado. Por favor, faça login novamente.');
            return;
        }
        
        if (!confirm(`Tem certeza que deseja apagar todos os registros de ${institution} deste mês? Essa ação não pode ser desfeita.`)) {
            return;
        }

        setIsLoading(true);
        try {
            const year = currentDate.getFullYear();
            const monthNum = String(currentDate.getMonth() + 1).padStart(2, '0');
            const refString = `${year}-${monthNum}-01`;

            console.log(`[InvestmentsView] Tentando limpar instituição: ${institution} para o mês: ${refString}`);
            await investmentService.deleteInvestmentsByInstitutionAndMonth(user.id, institution, refString);
            await fetchInvestments(currentDate);
            alert(`Registros de ${institution} deste mês foram apagados com sucesso.`);
        } catch (error) {
            console.error('Failed to clear institution:', error);
            alert('Erro ao apagar registros. Verifique o console para mais detalhes.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveInvestment = async (investmentData: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
        if (!user) return;

        if (editingInvestment) {
            await investmentService.updateInvestment(editingInvestment.id, {
                ...investmentData
            });
        } else {
            await investmentService.addInvestment({
                ...investmentData,
                user_id: user.id,
            } as any);
        }

        await fetchInvestments(currentDate);
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    const totalBalance = investments.reduce((sum, inv) => sum + Number(inv.balance), 0);
    const uniqueInstitutions = Array.from(new Set(investments.map(inv => inv.institution))) as string[];

    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    return (
        <div className="max-w-7xl mx-auto space-y-6 pb-20">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Investimentos</h1>
                    <p className="text-sm text-gray-400">Controle seu patrimônio investido</p>
                </div>

                <div className="flex items-center gap-4 bg-secondary border border-slate-700/50 rounded-xl p-1 shadow-lg">
                    <button onClick={handlePrevMonth} className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors text-gray-400 hover:text-white">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <div className="w-36 text-center font-medium capitalize select-none text-white">
                        {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
                    </div>
                    <button onClick={handleNextMonth} className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors text-gray-400 hover:text-white">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>

            <div className="bg-secondary rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl">
                <div className="p-6 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/30">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold text-white">Saldo Investido</h2>
                            {/* Info tooltip explaining reconciliation differences */}
                            <div className="relative group/tooltip">
                                <svg className="w-4 h-4 text-gray-500 hover:text-gray-300 transition-colors cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div className="absolute left-0 top-full mt-2 w-72 bg-slate-800 border border-slate-600/70 rounded-xl shadow-2xl p-4 opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-30 pointer-events-none">
                                    <p className="text-xs font-semibold text-white mb-2">📊 Sobre o Saldo Investido</p>
                                    <p className="text-xs text-gray-400 leading-relaxed">
                                        Este valor representa a soma de <strong className="text-gray-200">todas as posições individuais</strong> importadas das suas corretoras.
                                    </p>
                                    <p className="text-xs text-gray-400 leading-relaxed mt-2">
                                        Pode ser ligeiramente <strong className="text-amber-400">inferior ao total do extrato</strong> da corretora, pois extratos incluem saldo disponível em conta e juros acrescidos ainda não liquidados — que não têm linha individual no relatório.
                                    </p>
                                    <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-slate-700/50">
                                        ✅ Use "Importar Planilha" para ver o detalhamento completo da conferência.
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="text-3xl font-bold text-highlight mt-1">{formatCurrency(totalBalance)}</div>
                    </div>
                    <div className="flex gap-3 relative">
                        {uniqueInstitutions.length > 0 && (
                            <div className="relative group/clearBtn">
                                <button className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-red-400 hover:text-red-300 border border-slate-700/50 px-4 py-2 rounded-lg font-medium transition-colors">
                                    <svg className="w-5 h-5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    <span className="hidden sm:inline">Limpar Importação</span>
                                </button>
                                <div className="absolute right-0 top-full mt-2 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl opacity-0 invisible group-hover/clearBtn:opacity-100 group-hover/clearBtn:visible transition-all z-20">
                                    <div className="p-3 text-xs font-semibold text-gray-400 tracking-wider border-b border-slate-700/50">
                                        Excluir corretora neste mês
                                    </div>
                                    {uniqueInstitutions.map(inst => (
                                        <button
                                            key={inst}
                                            onClick={() => handleClearInstitution(inst)}
                                            className="w-full text-left px-4 py-3 hover:bg-slate-700/50 text-sm text-gray-300 hover:text-white transition-colors flex items-center gap-2 first:rounded-t-none last:rounded-b-lg"
                                        >
                                            <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            <span className="truncate">{inst}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        <button
                            onClick={() => setIsImportModalOpen(true)}
                            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700/50 px-4 py-2 rounded-lg font-medium transition-colors"
                        >
                            <svg className="w-5 h-5 text-highlight" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                            <span className="hidden sm:inline">Importar Planilha</span>
                        </button>
                        <button
                            onClick={() => { setEditingInvestment(null); setIsModalOpen(true); }}
                            className="flex items-center gap-2 bg-highlight hover:bg-highlight-hover text-white px-4 py-2 rounded-lg font-medium transition-all shadow-lg shadow-highlight/20"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                            <span className="hidden sm:inline">Adicionar</span>
                        </button>
                    </div>
                </div>

                <div className="p-6">
                    {isLoading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-highlight"></div>
                        </div>
                    ) : investments.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700/50 shadow-inner">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                            </div>
                            <p className="text-gray-400 mb-6">Nenhum investimento registrado neste mês.</p>

                            <button
                                onClick={handleCopyPrevious}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors border border-slate-700/50"
                            >
                                <svg className="w-5 h-5 text-highlight" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                                </svg>
                                Copiar do mês anterior
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Mobile Card View */}
                            <div className="block sm:hidden space-y-3 mb-6">
                                {investments.map((inv) => (
                                    <div key={inv.id} className="bg-slate-800/50 p-4 rounded-xl shadow-sm border border-slate-700/50 flex flex-col gap-2 relative group overflow-hidden">
                                        {/* Institution/Type Accent line */}
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-highlight/70"></div>

                                        <div className="flex justify-between items-start pl-2">
                                            <div className="flex flex-col gap-1 overflow-hidden pr-2">
                                                <span className="font-bold text-white leading-tight">
                                                    {inv.product_name || inv.product_type}
                                                </span>
                                                <span className="text-xs text-highlight font-medium">
                                                    {inv.institution}
                                                </span>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="inline-block px-2 py-0.5 rounded bg-slate-700 border border-slate-600 text-[9px] text-gray-300 uppercase tracking-wider">
                                                        {inv.product_type}
                                                    </span>
                                                    {inv.yield_rate && (
                                                        <span className="text-[10px] text-gray-400">
                                                            Rende: {inv.yield_rate}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end shrink-0">
                                                <span className="font-bold text-lg text-white">
                                                    {formatCurrency(Number(inv.balance))}
                                                </span>
                                                {inv.invested_principal && (
                                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                                                        Investido: {formatCurrency(Number(inv.invested_principal))}
                                                    </span>
                                                )}
                                                {inv.maturity_date && (
                                                    <span className="text-[9px] text-gray-400 mt-1 uppercase tracking-wider">
                                                        Venc: {new Date(inv.maturity_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex justify-end pt-2 mt-1 border-t border-slate-700/30 gap-3">
                                            <button
                                                onClick={() => { setEditingInvestment(inv); setIsModalOpen(true); }}
                                                className="text-highlight hover:text-sky-300 font-semibold p-1"
                                            >
                                                Editar
                                            </button>
                                            <button
                                                onClick={() => handleDelete(inv.id)}
                                                className="text-danger hover:text-red-400 font-semibold p-1"
                                            >
                                                Excluir
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Desktop Table View */}
                            <div className="hidden sm:block overflow-x-auto w-full">
                                <table className="min-w-[800px] sm:min-w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-700/50">
                                            <th className="pb-3 text-sm font-medium text-gray-400 pl-4 w-1/5">Instituição</th>
                                            <th className="pb-3 text-sm font-medium text-gray-400 w-2/5">Ativo</th>
                                            <th className="pb-3 text-sm font-medium text-gray-400">Rentabilidade</th>
                                            <th className="pb-3 text-sm font-medium text-gray-400">Vencimento</th>
                                            <th className="pb-3 text-sm font-medium text-gray-400 text-right pr-4">Saldo</th>
                                            <th className="pb-3 text-sm font-medium text-gray-400 w-24 text-center">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {investments.map((inv) => (
                                            <tr key={inv.id} className="border-b border-slate-700/50 hover:bg-slate-800/30 transition-colors group">
                                                <td className="py-4 pl-4 text-gray-400 text-sm font-medium">{inv.institution}</td>
                                                <td className="py-4 text-white">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="font-semibold line-clamp-1">{inv.product_name || inv.product_type}</span>
                                                        <span className="inline-block px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700/50 text-[10px] w-fit text-gray-400">
                                                            {inv.product_type}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-4 text-gray-300 text-sm">{inv.yield_rate || '-'}</td>
                                                <td className="py-4 text-gray-300 text-sm">
                                                    {inv.maturity_date ? new Date(inv.maturity_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '-'}
                                                </td>
                                                <td className="py-4 text-right pr-4">
                                                    <div className="flex flex-col items-end">
                                                        <span className="font-bold text-white">{formatCurrency(Number(inv.balance))}</span>
                                                        {inv.invested_principal && (
                                                            <span className="text-xs text-gray-500" title="Valor Principal Aplicado">
                                                                {formatCurrency(Number(inv.invested_principal))}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-4 text-center text-gray-400">
                                                    <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={() => { setEditingInvestment(inv); setIsModalOpen(true); }}
                                                            className="p-1.5 hover:bg-slate-700 hover:text-white rounded-lg transition-colors"
                                                            title="Editar"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(inv.id)}
                                                            className="p-1.5 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-colors"
                                                            title="Excluir"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <InvestmentModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveInvestment}
                initialData={editingInvestment}
                referenceMonth={currentDate}
            />

            <InvestmentImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                referenceMonth={currentDate}
                onImportSuccess={() => fetchInvestments(currentDate)}
            />

            {/* Mobile Floating Action Button (FAB) */}
            <button
                onClick={() => { setEditingInvestment(null); setIsModalOpen(true); }}
                className="fixed lg:hidden bottom-[80px] right-6 w-14 h-14 bg-highlight hover:bg-sky-400 text-white rounded-full shadow-[0_4px_14px_rgba(56,189,248,0.5)] flex items-center justify-center transition-transform active:scale-95 z-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-primary focus:ring-highlight"
                aria-label="Novo Investimento"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
            </button>
        </div>
    );
};

export default InvestmentsView;
