import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import Avatar from '../../Avatar'; // Importando nosso novo componente
import { SettingsIcon, LogoutIcon, LifebuoyIcon, TicketIcon } from '../ui/icons';

interface UserAccountWidgetProps {
    position?: 'top' | 'bottom';
    onNavigate?: (view: any) => void;
    userBadgeCount?: number;
    adminBadgeCount?: number;
    isAdmin?: boolean;
}

const UserAccountWidget: React.FC<UserAccountWidgetProps> = ({
    position = 'bottom',
    onNavigate,
    userBadgeCount = 0,
    adminBadgeCount = 0,
    isAdmin = false
}) => {
    const { user, signOut } = useAppStore();
    const [isOpen, setIsOpen] = useState(false);
    const widgetRef = useRef<HTMLDivElement>(null);

    const getFirstName = () => {
        if (!user) return 'Investidor';
        const metadataName = user.user_metadata?.full_name || user.user_metadata?.name;
        if (metadataName) return metadataName.split(' ')[0];
        const emailName = user.email?.split('@')[0];
        if (emailName) return emailName.charAt(0).toUpperCase() + emailName.slice(1);
        return 'Investidor';
    };

    const displayName = getFirstName();

    // Efeito para fechar o dropdown ao clicar fora dele
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (widgetRef.current && !widgetRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSignOut = async () => {
        if (window.confirm('Tem certeza que deseja sair da sua conta?')) {
            await signOut();
        }
        setIsOpen(false);
    };

    if (!user) {
        return null; // Não mostra o widget se não houver usuário logado
    }


    return (
        <div ref={widgetRef} className={`relative ${position === 'bottom' ? 'mt-auto' : ''}`}>
            {/* Área clicável do usuário */}
            <button onClick={() => setIsOpen(!isOpen)} className={`flex items-center gap-3 p-2 lg:p-3 text-left rounded-lg hover:bg-primary transition-colors duration-200 ${position === 'bottom' ? 'w-full landscape:justify-center lg:justify-start' : 'p-1'}`}>
                <Avatar user={user} className={position === 'top' ? 'h-8 w-8' : 'h-10 w-10'} />
                <div className={`hidden lg:block flex-1 overflow-hidden`}>
                    <p className="text-sm font-semibold text-light truncate">{displayName}</p>
                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                </div>
            </button>

            {/* Menu Dropdown */}
            {isOpen && (
                <div className={`absolute ${position === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2'} right-0 lg:right-auto w-56 bg-secondary rounded-lg shadow-2xl border border-primary z-50`}>
                    <div className="p-3 border-b border-primary">
                        <p className="text-sm font-semibold text-light truncate">{displayName}</p>
                        <p className="text-xs text-gray-400 truncate">{user.email}</p>
                    </div>
                    <nav className="p-1 space-y-1">
                        <button
                            onClick={() => { onNavigate?.('help'); setIsOpen(false); }}
                            className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-300 hover:bg-primary rounded-md transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <LifebuoyIcon className="h-5 w-5" />
                                <span>Central de Ajuda</span>
                            </div>
                            {userBadgeCount > 0 && (
                                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                    {userBadgeCount}
                                </span>
                            )}
                        </button>

                        {isAdmin && (
                            <button
                                onClick={() => { onNavigate?.('admin'); setIsOpen(false); }}
                                className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-300 hover:bg-primary rounded-md transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <TicketIcon className="h-5 w-5" />
                                    <span>Chamados (Admin)</span>
                                </div>
                                {adminBadgeCount > 0 && (
                                    <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                        {adminBadgeCount}
                                    </span>
                                )}
                            </button>
                        )}

                        <button
                            onClick={() => { onNavigate?.('pricing'); setIsOpen(false); }}
                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-primary rounded-md transition-colors"
                        >
                            <SettingsIcon className="h-5 w-5" />
                            <span>Gerenciar Conta</span>
                        </button>

                        <div className="border-t border-primary my-1"></div>

                        <button onClick={handleSignOut} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-primary rounded-md transition-colors">
                            <LogoutIcon className="h-5 w-5" />
                            <span>Sair da Conta</span>
                        </button>
                    </nav>
                </div>
            )}
        </div>
    );
};

export default UserAccountWidget;