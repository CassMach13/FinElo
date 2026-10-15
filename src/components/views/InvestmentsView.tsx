import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { appAlert } from '../../hooks/useDialogStore';
import { Investment } from '../../types';
import { investmentService } from '../../services/investmentService';
import InvestmentModal from '../modals/InvestmentModal';
import InvestmentImportModal from '../modals/InvestmentImportModal';
import InvestmentBalanceDisplay, { InvestmentBalanceColumnHeader } from '../investments/InvestmentBalanceDisplay';
import PortfolioSummary from '../investments/PortfolioSummary';
import PortfolioHistoryChart from '../investments/PortfolioHistoryChart';
import PortfolioAllocation from '../investments/PortfolioAllocation';
import PortfolioConcentration from '../investments/PortfolioConcentration';
import PortfolioMaturities from '../investments/PortfolioMaturities';
import PortfolioInsightsNarrative from '../investments/PortfolioInsightsNarrative';
import {
    buildInstitutionAllocation,
    buildMaturityAgenda,
    buildPortfolioNarrative,
    buildTypeAllocation,
    localDateString,
    selectMonthPositions,
    topGroup,
} from '../../domain/investments/portfolioInsights';
import { formatCurrency } from '../../utils/formatters';
import {
    buildMonthlySeries,
    createRequestGuard,
    dateFromMonthKey,
    formatMonthLabel,
    monthKeyFromDate,
    summarizePortfolio,
    type PortfolioRow,
} from '../../domain/investments/portfolioOverview';
import { createPortfolioFetcher, isSnapshotReady, resolveInitialMonthKey, HISTORY_MONTHS, type PortfolioLoaderDeps } from '../../services/investmentPortfolioLoader';
import { isInvestmentPortfoliosEnabled } from '../../services/featureFlagService';
import { useInvestmentStructure } from '../../hooks/useInvestmentStructure';
import { filterPositions, groupPositionsByPortfolio, type PortfolioFilter } from '../../domain/investments/portfolioGrouping';
import PortfolioShelf from '../investments/PortfolioShelf';
import ClassificationBadge from '../investments/ClassificationBadge';
import PortfolioFormModal from '../investments/PortfolioFormModal';
import PortfolioManagerDrawer from '../investments/PortfolioManagerDrawer';
import ClassifyInvestmentModal from '../investments/ClassifyInvestmentModal';
import { copyClassificationNotice } from '../investments/portfolioMessages';
import InvestmentOwnerSelector from '../investments/InvestmentOwnerSelector';
import { ownerLabelFor, resolveViewOwner, viewScopeKey, type InvestmentOwnerOption } from '../../domain/investments/ownerScope';

const InvestmentsView: React.FC = () => {
    const { user, isWealth, setCurrentView } = useAppStore();
    /** V2-B1B: carteiras e posições. Desligada = a tela de sempre, sem nenhuma consulta às tabelas novas. */
    const portfoliosEnabled = isWealth && isInvestmentPortfoliosEnabled(user);
    /** D3: proprietário consultado. Sem a flag (ou sem seleção válida) é sempre a própria sessão, como na V2-A. */
    const [ownerSessionState, setOwnerSessionState] = useState<{
        sessionUserId: string; selectedOwnerId: string | null; options: InvestmentOwnerOption[];
    } | null>(null);
    const currentOwnerState = ownerSessionState?.sessionUserId === user?.id ? ownerSessionState : null;
    const selectedOwnerId = currentOwnerState?.selectedOwnerId ?? null;
    const ownerOptions = currentOwnerState?.options ?? [];
    const setSelectedOwnerId = useCallback((id: string | null) => {
        if (!user?.id) { setOwnerSessionState(null); return; }
        setOwnerSessionState((state) => ({
            sessionUserId: user.id, selectedOwnerId: id,
            options: state?.sessionUserId === user.id ? state.options : [],
        }));
    }, [user?.id]);
    const setOwnerOptions = useCallback((options: InvestmentOwnerOption[]) => {
        if (!user?.id) return;
        setOwnerSessionState((state) => ({
            sessionUserId: user.id, options,
            selectedOwnerId: state?.sessionUserId === user.id ? state.selectedOwnerId : null,
        }));
    }, [user?.id]);
    const viewOwnerId = resolveViewOwner(user?.id, portfoliosEnabled ? selectedOwnerId : null, ownerOptions);
    const viewingOther = !!user && !!viewOwnerId && viewOwnerId !== user.id;
    /** Escopo de cada busca: sessão + proprietário. Resposta de outro escopo nunca é exibida. */
    const viewScope = user && viewOwnerId ? viewScopeKey(user.id, viewOwnerId) : '';
    const ownerLabel = ownerLabelFor(viewOwnerId, user?.id, ownerOptions);
    const [currentDate, setCurrentDate] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });
    const [rawInvestments, setInvestments] = useState<Investment[]>([]);
    const [history, setHistory] = useState<PortfolioRow[]>([]);
    /** Mês a que `rawInvestments`/`history` pertencem: nunca exibimos dados de outro mês sob o mês selecionado. */
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    /** Dono do snapshot: dados de outro usuário nunca são exibidos, nem por um render intermediário. */
    const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [editingInvestment, setEditingInvestment] = useState<Investment | null>(null);
    /** Sessão cujo mês inicial já foi resolvido (a primeira busca espera por isso). */
    const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
    const [autoSelectedKey, setAutoSelectedKey] = useState<string | null>(null);

    const [portfolioFilter, setPortfolioFilter] = useState<PortfolioFilter>(null);
    /** Formulário de carteira aberto: `portfolioId` nulo = nova carteira. */
    const [portfolioForm, setPortfolioForm] = useState<{ portfolioId: string | null } | null>(null);
    const [managedPortfolioId, setManagedPortfolioId] = useState<string | null>(null);
    const [portfolioNotice, setPortfolioNotice] = useState<string | null>(null);
    const [classifyingId, setClassifyingId] = useState<string | null>(null);
    const structure = useInvestmentStructure(portfoliosEnabled, viewOwnerId);

    const guardRef = useRef(createRequestGuard());
    const liveUserIdRef = useRef('');
    liveUserIdRef.current = user?.id ?? '';
    const liveScopeRef = useRef('');
    liveScopeRef.current = viewScope;
    const userNavigatedRef = useRef(false);

    const currentKey = monthKeyFromDate(currentDate);
    const todayKey = monthKeyFromDate(new Date());

    const buildDeps = (userId: string): PortfolioLoaderDeps => ({
        getDetail: (key) => investmentService.getInvestments(dateFromMonthKey(key), userId),
        getHistory: (start, end) => investmentService.getInvestmentHistory(userId, start, end),
        getLatestMonthKey: (today) => investmentService.getLatestReferenceMonthKey(userId, today),
    });

    /** Busca detalhamento + histórico juntos. Só a última busca da sessão atual pode gravar; erro preserva os dados. */
    const fetcherRef = useRef(
        createPortfolioFetcher(guardRef.current, () => liveScopeRef.current, {
            onLoading: (loading) => setIsLoading(loading),
            onData: (data) => {
                setInvestments(data.detail);
                setHistory(data.history);
                setLoadedKey(data.monthKey);
                setLoadedUserId(data.userId);
                setLoadError(false);
            },
            onError: (error) => {
                console.error('Failed to fetch investments:', error);
                setLoadError(true);
            },
        })
    );
    const fetchInvestments = async (date: Date) => {
        if (!user || !viewOwnerId) return;
        await fetcherRef.current(buildDeps(viewOwnerId), viewScope, monthKeyFromDate(date));
    };

    // Nova sessão: descarta tudo da anterior, volta ao mês corrente e procura a última posição disponível.
    useEffect(() => {
        guardRef.current.invalidate();
        userNavigatedRef.current = false;
        setInvestments([]);
        setHistory([]);
        setLoadedKey(null);
        setLoadedUserId(null);
        setLoadError(false);
        setAutoSelectedKey(null);
        setResolvedUserId(null);
        setSelectedOwnerId(null);
        const now = new Date();
        setCurrentDate(new Date(now.getFullYear(), now.getMonth(), 1));
        if (!user) return undefined;
        const userId = user.id;
        let cancelled = false;
        (async () => {
            let key = todayKey;
            try {
                key = await resolveInitialMonthKey(buildDeps(userId), todayKey);
            } catch (error) {
                console.error('Failed to resolve latest investment month:', error);
            }
            if (cancelled || liveUserIdRef.current !== userId) return;
            if (!userNavigatedRef.current && key !== todayKey) {
                setCurrentDate(dateFromMonthKey(key));
                setAutoSelectedKey(key);
            }
            setResolvedUserId(userId);
        })();
        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    useEffect(() => {
        if (!user || resolvedUserId !== user.id) return;
        fetchInvestments(currentDate);
    }, [currentKey, user?.id, resolvedUserId, viewScope]);

    // Outro proprietário: nada da consulta anterior (filtro, modais, avisos) continua aberto.
    useEffect(() => {
        setPortfolioFilter(null);
        setClassifyingId(null);
        setManagedPortfolioId(null);
        setPortfolioForm(null);
        setPortfolioNotice(null);
    }, [viewOwnerId]);

    const viewReady = isSnapshotReady({ monthKey: loadedKey, userId: loadedUserId }, currentKey, viewScope);
    const investments = viewReady ? rawInvestments : [];
    const summary = useMemo(() => summarizePortfolio(viewReady ? history : [], currentKey), [history, currentKey, viewReady]);
    // V2-A2: tudo derivado de `investments` (já validado por viewReady); sem consulta nova nem estado remoto próprio.
    const todayDate = localDateString(new Date());
    const insights = useMemo(() => {
        const positions = selectMonthPositions(investments, currentKey);
        const institutions = buildInstitutionAllocation(positions);
        const types = buildTypeAllocation(positions);
        const maturities = buildMaturityAgenda(positions, currentKey, todayDate);
        return {
            institutions,
            types,
            maturities,
            topInstitution: topGroup(institutions),
            topType: topGroup(types),
            narrative: buildPortfolioNarrative({ monthKey: currentKey, positions, institutions, types, maturities }),
        };
    }, [investments, currentKey, todayDate]);
    const portfolioGrouping = useMemo(() => {
        if (!portfoliosEnabled || !viewReady || !viewOwnerId || !structure.loaded || structure.ownerUserId !== viewOwnerId) return null;
        return groupPositionsByPortfolio({ positions: investments, portfolios: structure.portfolios, monthKey: currentKey, ownerUserId: viewOwnerId });
    }, [portfoliosEnabled, viewReady, viewOwnerId, structure.loaded, structure.ownerUserId, structure.portfolios, investments, currentKey]);
    const portfolioById = useMemo(() => new Map(structure.portfolios.map((p) => [p.id, p])), [structure.portfolios]);
    const holdingById = useMemo(() => new Map(structure.holdings.map((h) => [h.id, h])), [structure.holdings]);
    const hiddenArchivedPortfolios = portfolioGrouping
        ? structure.portfolios.filter((p) => p.archived_at && p.user_id === portfolioGrouping.ownerUserId && !portfolioGrouping.groups.some((g) => g.portfolioId === p.id))
        : [];
    /** Só posições do snapshot validado (mês e proprietário atuais) podem ser classificadas. */
    const classifyingInvestment = classifyingId && portfolioGrouping ? investments.find((inv) => inv.id === classifyingId) ?? null : null;
    const managedPortfolio = managedPortfolioId ? portfolioById.get(managedPortfolioId) ?? null : null;
    const handleStructureChanged = (message: string) => {
        setPortfolioNotice(message);
        void structure.reload();
    };
    /** Lista exibida: com a flag desligada é exatamente `investments`. */
    const listedInvestments = portfolioGrouping ? filterPositions(investments, portfolioGrouping, portfolioFilter) : investments;
    const series = useMemo(() => buildMonthlySeries(viewReady ? history : [], currentKey, HISTORY_MONTHS), [history, currentKey, viewReady]);

    const handlePrevMonth = () => {
        userNavigatedRef.current = true;
        setAutoSelectedKey(null);
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    };

    const handleNextMonth = () => {
        userNavigatedRef.current = true;
        setAutoSelectedKey(null);
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
            const result = await investmentService.copyFromPreviousMonth(user.id, currentDate, { preserveClassification: portfoliosEnabled });
            await fetchInvestments(currentDate);
            const notice = portfoliosEnabled ? copyClassificationNotice(result) : null;
            if (notice) setPortfolioNotice(notice);
        } catch (error) {
            console.error('Failed to copy investments:', error);
            setIsLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja remover este investimento?')) return;
        try {
            await investmentService.deleteInvestment(id);
            await fetchInvestments(currentDate);
            await appAlert('Investimento removido com sucesso.', 'Sucesso', 'success');
        } catch (error) {
            console.error('Failed to delete investment:', error);
            await appAlert('Erro ao remover investimento. Verifique sua conexão e tente novamente.', 'Erro', 'danger');
        }
    };

    const handleClearInstitution = async (institution: string) => {
        if (!user) {
            await appAlert('Usuário não identificado. Por favor, faça login novamente.', 'Erro', 'danger');
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
            await appAlert(`Registros de ${institution} deste mês foram apagados com sucesso.`, 'Sucesso', 'success');
        } catch (error) {
            console.error('Failed to clear institution:', error);
            await appAlert('Erro ao apagar registros. Verifique o console para mais detalhes.', 'Erro', 'danger');
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

    const formatInvestmentDate = (iso?: string) => {
        if (!iso) return null;
        return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    };

    const formatYieldCell = (inv: Investment) => {
        const parts: string[] = [];
        if (inv.yield_rate) parts.push(inv.yield_rate);
        if (inv.monthly_yield_rate) parts.push(`${inv.monthly_yield_rate}/mês`);
        return parts.length ? parts.join(' · ') : '-';
    };

    const renderClassification = (inv: Investment) => {
        const portfolio = inv.portfolio_id ? portfolioById.get(inv.portfolio_id) : undefined;
        const holding = inv.holding_id ? holdingById.get(inv.holding_id) : undefined;
        return (
            <div className="mt-1 max-w-full">
                <ClassificationBadge
                    portfolioName={inv.portfolio_id ? portfolio?.name ?? 'Carteira indisponível' : null}
                    archived={!!portfolio?.archived_at}
                    holdingName={holding?.display_name ?? null}
                    onAction={() => setClassifyingId(inv.id)}
                />
            </div>
        );
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
                    {portfoliosEnabled && viewOwnerId && (
                        <div className="mt-2">
                            <InvestmentOwnerSelector value={viewOwnerId} onChange={setSelectedOwnerId} onOptionsChange={setOwnerOptions} />
                        </div>
                    )}
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

            {viewingOther && (
                <p data-viewing-owner="" role="status" className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2.5 text-sm text-violet-100">
                    Você está vendo os investimentos de <strong>{ownerLabel}</strong>. Dá para organizar carteiras e classificar posições; lançar, importar, editar e excluir continuam com o titular.
                </p>
            )}

            {autoSelectedKey === currentKey && currentKey !== todayKey && (
                <p data-latest-position-note="" role="status" className="rounded-xl border border-teal-300/20 bg-teal-300/10 px-4 py-2.5 text-sm text-teal-100">
                    Mostrando sua última posição registrada: {formatMonthLabel(currentKey)}. Não há posições em {formatMonthLabel(todayKey)}.
                </p>
            )}

            {loadError && viewReady && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-600/60 bg-slate-800/60 px-4 py-2.5 text-sm text-gray-200">
                    <span>Não foi possível atualizar os dados agora. Exibindo o último resultado carregado.</span>
                    <button onClick={() => fetchInvestments(currentDate)} className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700/60">Tentar novamente</button>
                </div>
            )}

            {viewReady && <PortfolioSummary summary={summary} />}
            {viewReady && <PortfolioHistoryChart months={series} selectedKey={currentKey} />}
            {viewReady && (
                <>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <PortfolioAllocation title="Alocação por instituição" subtitle="Participação de cada instituição no saldo registrado do mês." allocation={insights.institutions} dataKey="institution" />
                        <PortfolioAllocation title="Alocação por tipo de investimento" subtitle="Tipos exatamente como constam no cadastro ou no extrato." allocation={insights.types} dataKey="type" />
                    </div>
                    <PortfolioConcentration institution={insights.topInstitution} type={insights.topType} />
                    <PortfolioMaturities agenda={insights.maturities} monthKey={currentKey} />
                    <PortfolioInsightsNarrative lines={insights.narrative} />
                </>
            )}

            {portfoliosEnabled && viewReady && portfolioNotice && (
                <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-100">
                    <span>{portfolioNotice}</span>
                    <button onClick={() => setPortfolioNotice(null)} aria-label="Fechar aviso" className="rounded-lg px-2 text-emerald-200 hover:bg-emerald-400/10">×</button>
                </div>
            )}

            {portfoliosEnabled && viewReady && (
                <PortfolioShelf
                    status={structure.status}
                    grouping={portfolioGrouping}
                    monthLabel={formatMonthLabel(currentKey)}
                    ownerLabel={ownerLabel}
                    filter={portfolioFilter}
                    onFilterChange={setPortfolioFilter}
                    onRetry={() => { void structure.reload(); }}
                    onCreatePortfolio={() => setPortfolioForm({ portfolioId: null })}
                    onManagePortfolio={setManagedPortfolioId}
                    hiddenArchived={hiddenArchivedPortfolios}
                />
            )}

            <div className="bg-secondary rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl">
                <div className="p-6 border-b border-slate-700/50 flex flex-wrap justify-between items-center gap-3 bg-slate-800/30">
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
                        {!viewingOther && uniqueInstitutions.length > 0 && (
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
                        {!viewingOther && (
                            <button
                                onClick={() => setIsImportModalOpen(true)}
                                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700/50 px-4 py-2 rounded-lg font-medium transition-colors"
                            >
                                <svg className="w-5 h-5 text-highlight" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                <span className="hidden sm:inline">Importar Planilha</span>
                            </button>
                        )}
                        {!viewingOther && (
                            <button
                                onClick={() => { setEditingInvestment(null); setIsModalOpen(true); }}
                                className="flex items-center gap-2 bg-highlight hover:bg-highlight-hover text-white px-4 py-2 rounded-lg font-medium transition-all shadow-lg shadow-highlight/20"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                <span className="hidden sm:inline">Adicionar</span>
                            </button>
                        )}
                    </div>
                </div>

                <div className="p-6">
                    {isLoading || (!viewReady && !loadError) ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-highlight"></div>
                        </div>
                    ) : !viewReady ? (
                        <div role="alert" className="text-center py-12">
                            <p className="text-gray-300 mb-4">Não foi possível carregar os investimentos de {formatMonthLabel(currentKey)}.</p>
                            <button onClick={() => fetchInvestments(currentDate)} className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors border border-slate-700/50">Tentar novamente</button>
                        </div>
                    ) : investments.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700/50 shadow-inner">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                            </div>
                            <p className="text-gray-400 mb-6">Nenhum investimento registrado neste mês.</p>

                            {!viewingOther && (
                                <button
                                    onClick={handleCopyPrevious}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors border border-slate-700/50"
                                >
                                    <svg className="w-5 h-5 text-highlight" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                                    </svg>
                                    Copiar do mês anterior
                                </button>
                            )}
                        </div>
                    ) : listedInvestments.length === 0 ? (
                        <div data-portfolio-filter-empty="" className="text-center py-12">
                            <p className="text-gray-400 mb-4">Nenhuma posição neste filtro em {formatMonthLabel(currentKey)}.</p>
                            <button onClick={() => setPortfolioFilter(null)} className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors border border-slate-700/50">Ver todas as posições</button>
                        </div>
                    ) : (
                        <>
                            {/* Mobile Card View */}
                            <div className="block sm:hidden space-y-3 mb-6">
                                {listedInvestments.map((inv) => (
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
                                                    {(inv.yield_rate || inv.monthly_yield_rate) && (
                                                        <span className="text-[10px] text-gray-400">
                                                            {formatYieldCell(inv)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end shrink-0 gap-2">
                                                <InvestmentBalanceDisplay
                                                    balance={Number(inv.balance)}
                                                    investedPrincipal={inv.invested_principal}
                                                    originalAppliedAmount={inv.original_applied_amount}
                                                    grossReturnAmount={inv.gross_return_amount}
                                                    productType={inv.product_type}
                                                    align="right"
                                                />
                                                <div className="flex flex-col items-end gap-0.5 text-[10px] text-gray-400 border-t border-slate-700/40 pt-2 w-full">
                                                    <span>
                                                        <span className="text-gray-500 uppercase tracking-wide">Aplicação </span>
                                                        {formatInvestmentDate(inv.application_date) ?? '—'}
                                                    </span>
                                                    <span>
                                                        <span className="text-gray-500 uppercase tracking-wide">Vencimento </span>
                                                        {formatInvestmentDate(inv.maturity_date) ?? '—'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {portfolioGrouping && <div className="pl-2">{renderClassification(inv)}</div>}

                                        {!viewingOther && (
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
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Desktop Table View */}
                            <div className="hidden sm:block overflow-x-auto w-full">
                                <table className="min-w-[960px] sm:min-w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-700/50">
                                            <th className="pb-3 text-sm font-medium text-gray-400 pl-4">Instituição</th>
                                            <th className="pb-3 text-sm font-medium text-gray-400 min-w-[180px]">Ativo</th>
                                            <th className="pb-3 text-sm font-medium text-gray-400">Rentabilidade</th>
                                            <th className="pb-3 text-sm font-medium text-gray-400 whitespace-nowrap">Aplicação</th>
                                            <th className="pb-3 text-sm font-medium text-gray-400 whitespace-nowrap">Vencimento</th>
                                            <th className="pb-3 whitespace-nowrap">
                                                <InvestmentBalanceColumnHeader />
                                            </th>
                                            <th className="pb-3 text-sm font-medium text-gray-400 w-24 text-center">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {listedInvestments.map((inv) => (
                                            <tr key={inv.id} className="border-b border-slate-700/50 hover:bg-slate-800/30 transition-colors group">
                                                <td className="py-4 pl-4 text-gray-400 text-sm font-medium">{inv.institution}</td>
                                                <td className="py-4 text-white">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="font-semibold line-clamp-1">{inv.product_name || inv.product_type}</span>
                                                        <span className="inline-block px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700/50 text-[10px] w-fit text-gray-400">
                                                            {inv.product_type}
                                                        </span>
                                                        {portfolioGrouping && renderClassification(inv)}
                                                    </div>
                                                </td>
                                                <td className="py-4 text-gray-300 text-sm max-w-[140px]">{formatYieldCell(inv)}</td>
                                                <td className="py-4 text-gray-300 text-sm whitespace-nowrap" title="Data da aplicação">
                                                    {inv.application_date ? (
                                                        <span className="text-slate-200">{formatInvestmentDate(inv.application_date)}</span>
                                                    ) : (
                                                        <span className="text-gray-600">—</span>
                                                    )}
                                                </td>
                                                <td className="py-4 text-gray-300 text-sm whitespace-nowrap" title="Data de vencimento">
                                                    {inv.maturity_date ? (
                                                        <span className="text-slate-200">{formatInvestmentDate(inv.maturity_date)}</span>
                                                    ) : (
                                                        <span className="text-gray-600">—</span>
                                                    )}
                                                </td>
                                                <td className="py-4 pr-4 align-top">
                                                    <InvestmentBalanceDisplay
                                                        balance={Number(inv.balance)}
                                                        investedPrincipal={inv.invested_principal}
                                                        originalAppliedAmount={inv.original_applied_amount}
                                                        grossReturnAmount={inv.gross_return_amount}
                                                        productType={inv.product_type}
                                                        align="right"
                                                    />
                                                </td>
                                                <td className="py-4 text-center text-gray-400">
                                                    {!viewingOther && (
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
                                                    )}
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

            {/* Montado só enquanto aberto: fechar descarta a sessão de importação inteira */}
            {isImportModalOpen && (
                <InvestmentImportModal
                    isOpen
                    onClose={() => setIsImportModalOpen(false)}
                    referenceMonth={currentDate}
                    onImportSuccess={() => fetchInvestments(currentDate)}
                />
            )}

            {portfoliosEnabled && viewOwnerId && managedPortfolio && (
                <PortfolioManagerDrawer
                    portfolio={managedPortfolio}
                    holdings={structure.holdings.filter((h) => h.portfolio_id === managedPortfolio.id)}
                    ownerUserId={viewOwnerId}
                    ownerLabel={ownerLabel}
                    monthLabel={formatMonthLabel(currentKey)}
                    positionsThisMonth={portfolioGrouping?.groups.find((g) => g.portfolioId === managedPortfolio.id)?.positionIds.length ?? 0}
                    onClose={() => setManagedPortfolioId(null)}
                    onRename={() => setPortfolioForm({ portfolioId: managedPortfolio.id })}
                    onChanged={handleStructureChanged}
                />
            )}

            {portfoliosEnabled && viewOwnerId && classifyingInvestment && (
                <ClassifyInvestmentModal
                    investment={classifyingInvestment}
                    ownerUserId={viewOwnerId}
                    ownerLabel={ownerLabel}
                    monthLabel={formatMonthLabel(currentKey)}
                    portfolios={structure.portfolios}
                    holdings={structure.holdings}
                    monthPositions={investments}
                    onClose={() => setClassifyingId(null)}
                    onCreatePortfolio={() => setPortfolioForm({ portfolioId: null })}
                    onDone={(message, structureChanged) => {
                        setClassifyingId(null);
                        setPortfolioNotice(message);
                        if (structureChanged) void structure.reload();
                        void fetchInvestments(currentDate);
                    }}
                />
            )}

            {portfoliosEnabled && viewOwnerId && portfolioForm && (
                <PortfolioFormModal
                    isOpen
                    ownerUserId={viewOwnerId}
                    ownerLabel={ownerLabel}
                    portfolio={portfolioForm.portfolioId ? portfolioById.get(portfolioForm.portfolioId) ?? null : null}
                    onClose={() => setPortfolioForm(null)}
                    onSaved={(saved) => {
                        setPortfolioForm(null);
                        handleStructureChanged(portfolioForm.portfolioId ? `Carteira renomeada para "${saved.name}".` : `Carteira "${saved.name}" criada.`);
                    }}
                />
            )}

            {/* Mobile Floating Action Button (FAB) */}
            {!viewingOther && (
                <button
                    onClick={() => { setEditingInvestment(null); setIsModalOpen(true); }}
                    className="fixed lg:hidden bottom-[80px] right-6 w-14 h-14 bg-highlight hover:bg-sky-400 text-white rounded-full shadow-[0_4px_14px_rgba(56,189,248,0.5)] flex items-center justify-center transition-transform active:scale-95 z-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-primary focus:ring-highlight"
                    aria-label="Novo Investimento"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                </button>
            )}
        </div>
    );
};

export default InvestmentsView;
