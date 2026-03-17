import React, { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

const InstallPWA: React.FC = () => {
    const [supportsPWA, setSupportsPWA] = useState(false);
    const [promptInstall, setPromptInstall] = useState<any>(null);
    const [isIOS, setIsIOS] = useState(false);
    const [showIOSInstructions, setShowIOSInstructions] = useState(false);

    useEffect(() => {
        // Check if iOS
        const userAgent = window.navigator.userAgent.toLowerCase();
        const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
        setIsIOS(isIosDevice);

        // Check if already installed
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;

        if (isStandalone) {
            return; // Already installed
        }

        const handler = (e: any) => {
            e.preventDefault();
            setSupportsPWA(true);
            setPromptInstall(e);
        };

        window.addEventListener('beforeinstallprompt', handler);

        // If iOS and not standalone, we can support "manual" install
        if (isIosDevice && !isStandalone) {
            setSupportsPWA(true);
        }

        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const handleInstallClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (isIOS) {
            setShowIOSInstructions(true);
            return;
        }

        if (!promptInstall) {
            return;
        }
        promptInstall.prompt();
    };

    if (!supportsPWA) {
        return null;
    }

    return (
        <>
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-4 shadow-lg flex flex-col items-start gap-3 mt-auto">
                <div className="flex items-center gap-3">
                    <div className="bg-accent/20 p-2 rounded-lg text-accent">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-light">Instalar App</h3>
                        <p className="text-xs text-slate-400">Acesse direto da tela inicial</p>
                    </div>
                </div>
                <Button onClick={handleInstallClick} className="w-full text-xs py-2 bg-gradient-to-r from-accent to-highlight hover:opacity-90 transition-opacity border-none">
                    Instalar Agora
                </Button>
            </div>

            {showIOSInstructions && (
                <Modal
                    isOpen={true}
                    onClose={() => setShowIOSInstructions(false)}
                    title="Instalar no iPhone/iPad"
                    footer={<Button onClick={() => setShowIOSInstructions(false)}>Entendi</Button>}
                >
                    <div className="flex flex-col gap-4 text-center">
                        <p className="text-sm text-gray-300">O iOS não permite instalação automática, mas é fácil:</p>
                        <div className="flex flex-col gap-2 items-center text-sm text-gray-400">
                            <p>1. Toque no botão <strong className="text-accent">Compartilhar</strong> (quadrado com seta) na barra inferior do Safari.</p>
                            <p>2. Role para baixo e toque em <strong className="text-light">"Adicionar à Tela de Início"</strong>.</p>
                            <p>3. Confirme clicando em <strong>Adicionar</strong>.</p>
                        </div>
                        <div className="bg-slate-800 p-2 rounded text-xs text-gray-500 mt-2">
                            Dica: Isso remove a barra de endereços e faz o FinElo parecer um app nativo.
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
};

export default InstallPWA;
