import React, { useEffect } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { useAppStore } from '../../hooks/useAppStore';
import { TourButton } from '../TourButton';

const PaymentSuccessView: React.FC = () => {
    const { fetchSubscription } = useAppStore();

    useEffect(() => {
        // Force refresh subscription on mount to see if webhook already processed
        fetchSubscription();
    }, []);

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6 animate-fade-in">
            <div className="text-6xl mb-4">🎉</div>
            <h1 className="text-4xl font-bold text-light">Parabéns! Você é Premium.</h1>
            <p className="text-gray-400 max-w-lg text-lg">
                Seu pagamento foi confirmado com sucesso. Obrigado por apoiar o FinElo!
                Todas as funcionalidades ilimitadas já estão disponíveis para você.
            </p>

            <Card className="bg-green-900/20 border-green-500/30 max-w-md p-6">
                <h3 className="text-green-400 font-bold mb-2">O que acontece agora?</h3>
                <p className="text-sm text-gray-300">
                    Nosso sistema está processando sua assinatura. Se as funcionalidades Premium ainda não aparecerem,
                    aguarde 1 ou 2 minutos e recarregue a página.
                </p>
            </Card>

            <div className="pt-8">
                <Button onClick={() => window.location.href = '/'} className="px-8 py-3 text-lg">
                    Ir para o Dashboard
                </Button>
            </div>
        </div>
    );
}

export default PaymentSuccessView;
