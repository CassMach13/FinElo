import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../hooks/useAppStore';
import DashboardView from '../components/views/DashboardView';
import ImportView from '../components/views/ImportView';
import TransactionsView from '../components/views/TransactionsView';
import SettingsView from '../components/views/SettingsView';
import HelpView from '../components/views/HelpView';
import AdminTicketsView from '../components/views/AdminTicketsView';
import PricingView from '../components/views/PricingView';
import PaymentSuccessView from '../components/views/PaymentSuccessView';
import InvestmentsView from '../components/views/InvestmentsView';
import {
    DashboardIcon,
    UploadIcon,
    ArrowsUpDownIcon,
    SettingsIcon,
    LifebuoyIcon,
    TicketIcon,
    TrendingUpIcon
} from '../components/ui/icons';
import { NavItem } from '../components/ui/NavItem';
import UserAccountWidget from '../components/views/UserAccountWidget';
import InstallPWA from '../components/pwa/InstallPWA';
import TermsModal from '../components/modals/TermsModal';

export default function MainLayout() {
    // Initialize view from URL if present
    // Navigation from store
    const { user, isPremium, supportTickets, fetchAllTickets, currentView, setCurrentView } = useAppStore();
    const isAdmin = user?.email === 'cassiomq@gmail.com';

    // Sincronizar view inicial baseada na URL
    useEffect(() => {
        const path = window.location.pathname;
        const searchParams = new URLSearchParams(window.location.search);
        const viewParam = searchParams.get('view');

        if (path === '/pricing' || viewParam === 'pricing') {
            setCurrentView('pricing');
        } else if (viewParam && viewMap[viewParam]) {
            setCurrentView(viewParam as any);
        }
    }, [setCurrentView]);

    // Admin Notification Logic: Pending Tickets
    const adminBadgeCount = useMemo(() => {
        if (!isAdmin) return 0;
        return supportTickets.filter(t => {
            if (t.status === 'resolved' || t.status === 'closed') return false;
            const msgs = t.messages || [];
            if (msgs.length === 0) return true; // New ticket with no messages
            // Check last message
            const lastMsg = [...msgs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).pop();
            return lastMsg?.sender_id === t.user_id; // Needs attention if last msg is from user
        }).length;
    }, [supportTickets, isAdmin]);

    // User Notification Logic: Answered Tickets
    const userBadgeCount = useMemo(() => {
        if (isAdmin) return 0;
        return supportTickets.filter(t => {
            const msgs = t.messages || [];
            if (msgs.length === 0) return false;
            const lastMsg = [...msgs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).pop();
            return lastMsg?.sender_id !== user?.id;
        }).length;
    }, [supportTickets, user, isAdmin]);

    // Force fetch all tickets if Admin to ensure badge is accurate globally
    useEffect(() => {
        if (isAdmin) {
            fetchAllTickets();
        }
    }, [isAdmin, fetchAllTickets]);

    const viewMap: Record<string, React.ReactNode> = {
        dashboard: <DashboardView />,
        import: <ImportView />,
        transactions: <TransactionsView />,
        investments: <InvestmentsView />,
        settings: <SettingsView />,
        help: <HelpView />,
        admin: isAdmin ? <AdminTicketsView /> : <DashboardView />,
        pricing: <PricingView />,
        success: <PaymentSuccessView />,
    };

    // Proteção extra: Se tentar acessar admin e não for admin, volta para dashboard
    useEffect(() => {
        if (currentView === 'admin' && !isAdmin) {
            setCurrentView('dashboard');
        }
    }, [currentView, isAdmin]);

    return (
        <div id="main-layout" className="flex flex-col h-screen bg-primary text-light overflow-hidden">
            {/* Cabeçalho Mobile - Visível apenas em telas menores que LG */}
            <header className="lg:hidden no-print flex items-center justify-between px-4 py-3 bg-secondary border-b border-white/5 z-50">
                <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg overflow-hidden flex items-center justify-center bg-slate-800/50 border border-slate-700/50">
                        <img src="/logo/Image_fx.png" alt="FinElo Logo" className="h-full w-full object-cover transform scale-150" />
                    </div>
                    <span className="text-lg font-bold">FinElo</span>
                </div>
                <UserAccountWidget
                    position="top"
                    onNavigate={setCurrentView}
                    userBadgeCount={userBadgeCount}
                    adminBadgeCount={adminBadgeCount}
                    isAdmin={isAdmin}
                />
            </header>

            <div className="flex-1 flex flex-col landscape:max-lg:flex-row lg:flex-row overflow-hidden">
                <nav className="no-print flex landscape:max-lg:flex-col lg:flex-col justify-around landscape:max-lg:justify-start lg:justify-start landscape:max-lg:p-2 lg:p-4 bg-secondary w-full landscape:max-lg:w-20 lg:w-64 max-w-full lg:max-w-[256px] space-y-0 landscape:max-lg:space-y-4 lg:space-y-2 order-last landscape:max-lg:order-first lg:order-first border-t landscape:max-lg:border-t-0 lg:border-t-0 border-r border-slate-800/50">
                    {/* Desktop Logo - Hidden on mobile */}
                    <div className="hidden lg:flex items-center gap-3 mb-6 px-3">
                        <div className="h-10 w-10 rounded-xl overflow-hidden flex items-center justify-center bg-slate-800/50 border border-slate-700/50">
                            <img src="/logo/Image_fx.png" alt="FinElo Logo" className="h-full w-full object-cover transform scale-150" />
                        </div>
                        <h1 className="text-xl font-bold">FinElo</h1>
                    </div>

                    <div className="flex landscape:max-lg:flex-col lg:flex-col justify-around landscape:max-lg:justify-start lg:justify-start w-full gap-1">
                        <NavItem id="nav-dashboard" view="dashboard" label="Dashboard" icon={<DashboardIcon />} isActive={currentView === 'dashboard'} onClick={() => setCurrentView('dashboard')} />
                        <NavItem id="nav-transactions" view="transactions" label="Transações" icon={<ArrowsUpDownIcon />} isActive={currentView === 'transactions'} onClick={() => setCurrentView('transactions')} />
                        <NavItem id="nav-import" view="import" label="Importar" icon={<UploadIcon />} isActive={currentView === 'import'} onClick={() => setCurrentView('import')} />
                        <NavItem id="nav-investments" view="investments" label="Investimentos" icon={<TrendingUpIcon />} isActive={currentView === 'investments'} onClick={() => setCurrentView('investments')} />
                        <NavItem id="nav-settings" view="settings" label="Configurações" icon={<SettingsIcon />} isActive={currentView === 'settings'} onClick={() => setCurrentView('settings')} />
                    </div>

                    <div className="hidden lg:flex flex-col border-t border-slate-700/50 mt-2 pt-2">
                        <button
                            onClick={() => setCurrentView('pricing')}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors mb-2 ${currentView === 'pricing' ? 'bg-highlight/20 text-highlight' : 'text-gray-400 hover:text-white hover:bg-slate-800'}`}
                        >
                            <div className={`h-5 w-5 flex-shrink-0 border border-current rounded-full flex items-center justify-center text-[10px] font-bold ${isPremium ? 'text-amber-400 border-amber-400' : ''}`}>
                                {isPremium ? '★' : '💎'}
                            </div>
                            <span className="font-semibold text-xs xl:text-sm truncate">
                                {isPremium ? 'Gerenciar Conta' : 'Assinar Premium'}
                            </span>
                        </button>

                        <NavItem
                            id="nav-help"
                            view="help"
                            label="Central de Ajuda"
                            icon={<LifebuoyIcon />}
                            isActive={currentView === 'help'}
                            onClick={() => setCurrentView('help')}
                            badge={userBadgeCount > 0 ? userBadgeCount : undefined}
                        />
                        {isAdmin && (
                            <NavItem
                                id="nav-admin"
                                view="admin"
                                label="Chamados (Admin)"
                                icon={<TicketIcon />}
                                isActive={currentView === 'admin'}
                                onClick={() => setCurrentView('admin')}
                                badge={adminBadgeCount > 0 ? adminBadgeCount : undefined}
                            />
                        )}
                    </div>

                    <div className="hidden lg:block mt-auto mb-4 scale-75 origin-bottom-left">
                        <InstallPWA />
                    </div>

                    {/* Desktop-only Account Widget at the bottom */}
                    <div className="hidden lg:block">
                        <UserAccountWidget
                            position="bottom"
                            onNavigate={setCurrentView}
                            userBadgeCount={userBadgeCount}
                            adminBadgeCount={adminBadgeCount}
                            isAdmin={isAdmin}
                        />
                    </div>
                </nav >
                <main id="main-content" className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
                    {viewMap[currentView] || viewMap.dashboard}
                </main>
            </div>
            <TermsModal />
        </div >
    );
}
