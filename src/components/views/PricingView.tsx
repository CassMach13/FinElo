import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../hooks/useAppStore';
import { CheckIcon } from '../ui/icons';

const PricingView: React.FC = () => {
    const { user, subscription, isPremium } = useAppStore();
    const [searchParams] = useSearchParams();
    const [showUpgradeWarning, setShowUpgradeWarning] = useState(false);
    const [isMonthly, setIsMonthly] = useState(false);

    const handleUpgrade = (plan: 'annual' | 'wealth' | 'lifetime') => {
        // Stripe links logic
        const links = {
            annual: isMonthly ? 'https://buy.stripe.com/28EbJ10919dd9KFgqufAc03' : 'https://buy.stripe.com/00w00jbRJfBBaOJ3DIfAc01',
            wealth: isMonthly ? 'https://buy.stripe.com/4gMaEX6xp1KL3mh1vAfAc04' : 'https://buy.stripe.com/00w14naNF1KL6ytb6afAc02',
            lifetime: 'https://buy.stripe.com/14AcN56xp899cWR3DIfAc00' // Founders Pack
        };

        // SAFETY CHECK: If user is already Annual and wants Lifetime, warn them.
        if (plan === 'lifetime' && subscription?.status === 'active') {
            setShowUpgradeWarning(true);
            return;
        }

        if (links[plan]) {
            const promoCode = searchParams.get('promo') || searchParams.get('coupon');
            const finalLink = promoCode 
                ? `${links[plan]}${links[plan].includes('?') ? '&' : '?'}prefilled_promo_code=${promoCode}`
                : links[plan];
            
            window.location.href = finalLink;
        }
    };

    const confirmUpgrade = () => {
        const lifetimeLink = 'https://buy.stripe.com/14AcN56xp899cWR3DIfAc00';
        window.location.href = lifetimeLink;
    };

    return (
        <div className="min-h-full py-12 px-4 sm:px-6 lg:px-8 relative">
            {/* Upgrade Warning Modal */}
            {showUpgradeWarning && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-yellow-500/50 rounded-2xl p-6 max-w-md w-full shadow-2xl relative">
                        <div className="flex items-center gap-3 text-yellow-500 mb-4">
                            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <h3 className="text-xl font-bold">Atenção ao Upgrade</h3>
                        </div>
                        <p className="text-gray-300 mb-6 leading-relaxed">
                            Você já possui uma assinatura <strong>Anual</strong> ativa.
                            <br /><br />
                            Ao comprar o <strong>Founder's Pack</strong>, sua assinatura anual <strong>NÃO</strong> será cancelada automaticamente pelo sistema de pagamentos.
                        </p>
                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-6 text-sm text-yellow-200">
                            <strong>Importante:</strong> Após pagar o Vitalício, você precisará clicar em "Gerenciar Assinatura" e cancelar manualmente sua renovação anual para evitar cobrança duplicada.
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowUpgradeWarning(false)}
                                className="px-4 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmUpgrade}
                                className="px-6 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold transition-colors"
                            >
                                Entendi, quero continuar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="text-center mb-16">
                <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Escolha sua Liberdade</h2>
                <p className="text-gray-400 max-w-2xl mx-auto mb-8">
                    Invista na sua tranquilidade financeira. Cancele a qualquer momento.
                </p>

                {/* Billing Toggle */}
                <div className="flex items-center justify-center gap-3">
                    <span className={`text-sm font-medium ${isMonthly ? 'text-white' : 'text-gray-400'}`}>Mensal</span>
                    <button
                        onClick={() => setIsMonthly(!isMonthly)}
                        className="relative inline-flex h-8 w-16 items-center rounded-full bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-primary"
                    >
                        <span
                            className={`inline-block h-6 w-6 transform rounded-full bg-accent transition-transform ${isMonthly ? 'translate-x-1' : 'translate-x-9'}`}
                        />
                    </button>
                    <span className={`text-sm font-medium ${!isMonthly ? 'text-white' : 'text-gray-400'}`}>
                        Anual <span className="text-green-400 text-xs ml-1 bg-green-400/10 px-2 py-0.5 rounded-full">-33%</span>
                    </span>
                </div>

                {/* Promo Code Indicator */}
                {(searchParams.get('promo') || searchParams.get('coupon')) && (
                    <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm animate-bounce">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                        <span>Cupom <strong>{searchParams.get('promo') || searchParams.get('coupon')}</strong> aplicado com sucesso!</span>
                    </div>
                )}
            </div>

            <div className="grid md:grid-cols-4 gap-6 max-w-7xl mx-auto items-center">
                {/* Free Plan */}
                <div className="rounded-3xl p-8 bg-secondary/40 border border-white/5 backdrop-blur-sm order-2 md:order-1 opacity-80 hover:opacity-100 transition-opacity">
                    <h3 className="text-2xl font-bold text-white mb-2">Basic</h3>
                    <div className="text-4xl font-bold text-white mb-6">Grátis</div>
                    <ul className="space-y-4 mb-8 text-gray-300 text-sm">
                        <li className="flex items-center gap-2"><CheckIcon /> 1 Importação mensal</li>
                        <li className="flex items-center gap-2"><CheckIcon /> Dashboard Resumido</li>
                        <li className="flex items-center gap-2"><CheckIcon /> Acesso Individual</li>
                    </ul>
                    <button disabled className="block w-full py-3 rounded-xl bg-white/5 text-gray-400 font-semibold text-center cursor-not-allowed border border-white/5">
                        Plano Atual
                    </button>
                </div>

                {/* PRO/Annual Plan */}
                <div className={`rounded-3xl p-8 bg-secondary/40 border backdrop-blur-sm order-3 md:order-2 transition-all ${isPremium ? 'border-green-500/30' : 'border-white/10 hover:border-accent/50'}`}>
                    <h3 className="text-2xl font-bold text-white mb-2">PRO {isMonthly ? 'Mensal' : 'Anual'}</h3>
                    <div className="text-4xl font-bold text-white mb-1"><span className="text-2xl">R$</span> {isMonthly ? '14,90' : '9,99'}<span className="text-lg text-gray-500 font-normal">/mês</span></div>
                    {isMonthly ? (
                        <p className="text-sm text-gray-400 mb-6 font-semibold">Cobrado R$ 14,90 por mês</p>
                    ) : (
                        <p className="text-sm text-green-400 mb-6 font-semibold">Cobrado R$ 119,90 por ano</p>
                    )}

                    <ul className="space-y-4 mb-8 text-gray-300">
                        <li className="flex items-center gap-2"><CheckIcon /> Importações Ilimitadas</li>
                        <li className="flex items-center gap-2"><CheckIcon /> Plano Família (+R$4,90/conta)</li>
                        <li className="flex items-center gap-2"><CheckIcon /> Dashboard Completo & IA</li>
                        <li className="flex items-center gap-2"><CheckIcon /> Suporte Prioritário</li>
                    </ul>
                    <div className="mt-4 mb-6 flex justify-center">
                        <div className="bg-slate-800/50 border border-white/5 rounded-lg px-4 py-1.5 shadow-sm">
                            <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">7 Dias de Garantia</span>
                        </div>
                    </div>

                    {isPremium ? (
                        <button disabled className="block w-full py-4 rounded-xl bg-green-500/20 text-green-400 font-bold text-lg text-center border border-green-500/20 cursor-default">
                            Já Possui Premium
                        </button>
                    ) : (
                        <button
                            onClick={() => handleUpgrade('annual')}
                            className="block w-full py-4 rounded-xl bg-white/10 text-white font-bold text-lg text-center hover:bg-white/20 transition-all"
                        >
                            Assinar PRO
                        </button>
                    )}
                </div>

                {/* Wealth Plan */}
                <div className={`rounded-3xl p-8 bg-secondary/40 border backdrop-blur-sm order-4 md:order-3 transition-all ${user?.id && subscription?.tier === 'wealth' && subscription?.status === 'active' ? 'border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]' : 'border-purple-500/20 hover:border-purple-500/50'}`}>
                    <h3 className="text-2xl font-bold text-white mb-2">Wealth {isMonthly ? 'Mensal' : 'Anual'}</h3>
                    <div className="text-4xl font-bold text-white mb-1"><span className="text-2xl">R$</span> {isMonthly ? '29,90' : '19,90'}<span className="text-lg text-gray-500 font-normal">/mês</span></div>
                    {isMonthly ? (
                        <p className="text-sm text-purple-400 mb-6 font-semibold opacity-0">Espaçador</p>
                    ) : (
                        <p className="text-sm text-purple-400 mb-6 font-semibold">Cobrado R$ 238,80 por ano</p>
                    )}

                    <ul className="space-y-4 mb-8 text-gray-300">
                        <li className="flex items-center gap-2"><CheckIcon /> <strong>Tudo do PRO</strong></li>
                        <li className="flex items-center gap-2"><CheckIcon /> <strong>Módulo de Investimentos</strong></li>
                        <li className="flex items-center gap-2"><CheckIcon /> Importação Multi-Corretora</li>
                        <li className="flex items-center gap-2"><CheckIcon /> 1 Vaga Família Inclusa</li>
                    </ul>
                    <div className="mt-4 mb-6 flex justify-center">
                        <div className="bg-slate-800/50 border border-white/5 rounded-lg px-4 py-1.5 shadow-sm">
                            <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">7 Dias de Garantia</span>
                        </div>
                    </div>

                    {user?.id && subscription?.tier === 'wealth' && subscription?.status === 'active' ? (
                        <button disabled className="block w-full py-4 rounded-xl bg-purple-500/20 text-purple-400 font-bold text-lg text-center border border-purple-500/20 cursor-default">
                            Plano Atual
                        </button>
                    ) : (
                        <button
                            onClick={() => handleUpgrade('wealth')}
                            className="block w-full py-4 rounded-xl bg-purple-600 border border-purple-500 text-white font-bold text-lg text-center hover:bg-purple-500 transition-all shadow-lg shadow-purple-500/20"
                        >
                            Assinar Wealth
                        </button>
                    )}
                </div>

                {/* Lifetime Plan */}
                <div className={`rounded-3xl p-8 bg-gradient-to-b from-purple-900 to-slate-900 border-2 shadow-2xl relative overflow-hidden transform md:scale-105 z-10 order-1 md:order-4 ${isPremium && subscription?.status !== 'active' ? 'border-purple-900 opacity-80' : 'border-purple-500'}`}>
                    {!isPremium && (
                        <div className="absolute top-0 right-0 bg-purple-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider">OFERTA ÚNICA</div>
                    )}
                    <h3 className="text-2xl font-bold text-white mb-2">Founder's Pack</h3>
                    <div className="text-4xl font-bold text-white mb-1"><span className="text-2xl">R$</span> 149,00</div>
                    <p className="text-sm text-purple-300 mb-6 font-semibold">Pagamento Único (Vitalício)</p>
                    <ul className="space-y-4 mb-8 text-white text-sm">
                        <li className="flex items-center gap-2"><CheckIcon color="text-purple-400" /> <strong>Acesso Vitalício</strong></li>
                        <li className="flex items-center gap-2"><CheckIcon color="text-purple-400" /> <strong>Todos os recursos Wealth</strong></li>
                        <li className="flex items-center gap-2"><CheckIcon color="text-purple-400" /> 1 Vaga Família Inclusa</li>
                        <li className="flex items-center gap-2"><CheckIcon color="text-purple-400" /> Selo "Founder" no perfil</li>
                        <li className="flex items-center gap-2"><CheckIcon color="text-purple-400" /> Apenas 50 unidades</li>
                    </ul>

                    {isPremium && subscription?.status !== 'active' ? (
                        <button disabled className="block w-full py-4 rounded-xl bg-purple-500/20 text-purple-300 font-bold text-lg text-center border border-purple-500/20 cursor-default">
                            Já Possui Premium
                        </button>
                    ) : (
                        <button
                            onClick={() => handleUpgrade('lifetime')}
                            className="block w-full py-4 rounded-xl bg-purple-600 text-white font-bold text-lg text-center hover:bg-purple-500 shadow-lg shadow-purple-500/25 transition-all animate-pulse"
                        >
                            {subscription?.status === 'active' ? 'Fazer Upgrade Vitalício' : 'Garantir Vitalício'}
                        </button>
                    )}
                </div>
            </div>

            <div className="mt-16 max-w-4xl mx-auto border border-blue-500/20 bg-blue-500/5 rounded-3xl p-8 flex flex-col md:flex-row items-center gap-8 shadow-xl">
                <div className="h-24 w-24 flex-shrink-0 bg-blue-500/20 rounded-full flex items-center justify-center border border-blue-500/30">
                    <svg className="w-12 h-12 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                </div>
                <div>
                    <h3 className="text-2xl font-bold text-white mb-2">Garantia Incondicional de 7 Dias</h3>
                    <p className="text-gray-400 leading-relaxed text-lg">
                        Teste o FinElo sem riscos. Se você não se adaptar ao app ou decidir que não é para você, pode solicitar o reembolso total em até 7 dias após a compra. Processo rápido e sem perguntas.
                    </p>
                </div>
            </div>

            {isPremium && (
                <div className="text-center mt-12 p-6 rounded-2xl bg-secondary/30 border border-white/5 max-w-2xl mx-auto">
                    <h4 className="text-xl font-bold text-white mb-2">Gerenciar Assinatura</h4>
                    <p className="text-gray-400 mb-4">
                        Para alterar seu plano, atualizar cartão ou cancelar, acesse o Portal do Cliente.
                        Dúvidas? <a href="mailto:suporte@finelo.app.br" className="text-accent hover:underline">Entre em contato</a>.
                    </p>
                    <a
                        href="https://billing.stripe.com/p/login/14AcN56xp899cWR3DIfAc00"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-6 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white font-medium transition-colors border border-white/10"
                    >
                        Acessar Portal do Cliente
                    </a>
                </div>
            )}
        </div>
    );
};

export default PricingView;
