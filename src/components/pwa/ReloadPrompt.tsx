import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import Button from '../ui/Button';

const ReloadPrompt: React.FC = () => {
    const {
        offlineReady: [offlineReady, setOfflineReady],
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(r) {
            console.log('SW Registered: ' + r);
        },
        onRegisterError(error) {
            console.log('SW registration error', error);
        },
    });

    const close = () => {
        setOfflineReady(false);
        setNeedRefresh(false);
    };

    if (!offlineReady && !needRefresh) {
        return null;
    }

    return (
        <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-8 md:bottom-8 z-[20000] animate-fadeIn">
            <div className="bg-slate-800 border-2 border-highlight/50 p-4 rounded-xl shadow-[0_0_20px_rgba(56,189,248,0.3)] flex flex-col gap-3 max-w-sm ml-auto">
                <div className="flex items-start gap-3">
                    <div className="bg-highlight/20 p-2 rounded-lg text-highlight mt-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-white">
                            {needRefresh ? 'Nova versão disponível!' : 'App pronto para uso offline'}
                        </h4>
                        <p className="text-xs text-gray-400 mt-1">
                            {needRefresh
                                ? 'Atualize antes de continuar para garantir que as operações usem a versão mais recente e segura.'
                                : 'O conteúdo foi baixado e o app funcionará mesmo sem internet.'}
                        </p>
                    </div>
                </div>

                <div className="flex gap-2 justify-end">
                    {!needRefresh && (
                        <button
                            onClick={close}
                            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                        >
                            Fechar
                        </button>
                    )}
                    {needRefresh && (
                        <Button
                            onClick={() => {
                                console.log('[PWA Update] Solicitando atualização...');
                                updateServiceWorker(true);
                                // Forçar reload após um pequeno delay caso o SW não dispare automaticamente
                                setTimeout(() => {
                                    console.log('[PWA Update] Fazendo reload forçado da página...');
                                    window.location.reload();
                                }, 1000);
                            }}
                            className="text-xs py-1.5 px-4 cursor-pointer relative z-[20005]"
                        >
                            Atualizar Agora
                        </Button>
                    )}
                    {!needRefresh && (
                        <Button
                            onClick={close}
                            variant="secondary"
                            className="text-xs py-1.5 px-4"
                        >
                            OK
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReloadPrompt;
