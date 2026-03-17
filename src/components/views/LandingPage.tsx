import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { UploadIcon, DashboardIcon, LifebuoyIcon, TicketIcon, ArrowsUpDownIcon, SettingsIcon, LockIcon, ShieldCheckIcon, InstagramIcon, FacebookIcon, WhatsappIcon } from '../ui/icons';
import TermsModal from '../modals/TermsModal';

const testimonials = [
    {
        name: "João Silva",
        role: "Empresário, 35",
        initials: "JS",
        quote: "Antes eu perdia horas conferindo faturas e extratos de 3 bancos diferentes. O FinElo resolve isso em 2 minutos. Foi um divisor de águas."
    },
    {
        name: "Maria Costa",
        role: "Médica, 42",
        initials: "MC",
        quote: "O plano família é sensacional. Acabaram as discussões no fim do mês sobre quem gastou com o quê. Tudo transparente e numa tela só."
    },
    {
        name: "Pedro Alves",
        role: "Engenheiro, 29",
        initials: "PA",
        quote: "Estou juntando para comprar meu primeiro apartamento. Ver a evolução do patrimônio todo mês com os gráficos do FinElo me dá motivação extra."
    }
];

const LandingPage: React.FC = () => {
    const [showTerms, setShowTerms] = useState(false);
    const [isMonthly, setIsMonthly] = useState(false);
    const [email, setEmail] = useState('');
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const promoCode = searchParams.get('promo') || searchParams.get('coupon');

    const handleGetStarted = (e: React.FormEvent) => {
        e.preventDefault();
        const extra = promoCode ? `&promo=${promoCode}` : '';
        if (email) {
            navigate(`/login?email=${encodeURIComponent(email)}${extra}`);
        } else {
            navigate(`/login?${extra.substring(1)}`);
        }
    };

    return (
        <div className="min-h-screen bg-primary text-light font-sans selection:bg-accent selection:text-white">
            {/* Navbar */}
            <nav className="fixed w-full z-50 bg-primary/90 backdrop-blur-md border-b border-white/10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg overflow-hidden flex items-center justify-center">
                                <img src="/logo/Image_fx.png" alt="FinElo Logo" className="h-full w-full object-cover" />
                            </div>
                            <span className="text-xl font-bold tracking-tight text-white/90">FinElo</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <Link to={`/login?${promoCode ? `promo=${promoCode}` : ''}`} className="text-sm font-medium text-gray-300 hover:text-white transition-colors">
                                Entrar
                            </Link>
                            <Link
                                to={`/login?${promoCode ? `promo=${promoCode}` : ''}`}
                                className="px-4 py-2 rounded-full bg-accent hover:bg-accent/90 text-white text-sm font-semibold shadow-lg shadow-accent/20 transition-all hover:scale-105 active:scale-95"
                            >
                                Começar Grátis
                            </Link>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-accent/20 blur-[120px] rounded-full pointer-events-none opacity-50" />

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
                    <motion.h1 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6 }}
                        className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8"
                    >
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-teal-200 via-teal-400 to-teal-500">
                            O Fim das
                        </span>
                        <br />
                        <span className="text-white">Planilhas Complexas</span>
                    </motion.h1>
                    <motion.p 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="mt-4 max-w-2xl mx-auto text-xl text-gray-400 mb-10"
                    >
                        Assuma o controle do seu futuro financeiro. Importe seus extratos em segundos, descubra para onde vai o seu dinheiro e prepare-se para as suas maiores conquistas individuais ou familiares.
                    </motion.p>
                    
                    <motion.form 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.4 }}
                        onSubmit={handleGetStarted}
                        className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-xl mx-auto"
                    >
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Seu melhor e-mail"
                            required
                            className="w-full sm:w-auto flex-1 px-6 py-4 rounded-full bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                        />
                        <button
                            type="submit"
                            className="w-full sm:w-auto px-8 py-4 rounded-full bg-accent hover:bg-accent/90 text-white font-bold text-lg shadow-xl shadow-accent/30 transition-all hover:-translate-y-1 hover:shadow-2xl"
                        >
                            Criar Conta
                        </button>
                    </motion.form>

                    {/* Promo Code Indicator */}
                    {promoCode && (
                        <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                            </svg>
                            <span>Parceria confirmada! Cupom <strong>{promoCode}</strong> será aplicado na assinatura.</span>
                        </motion.div>
                    )}

                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1, delay: 0.8 }}
                        className="mt-20 relative rounded-2xl border border-white/10 bg-secondary/50 shadow-2xl backdrop-blur-sm p-2 lg:p-4 rotate-x-12 transform-gpu perspective-1000 max-w-5xl mx-auto"
                    >
                        <div className="absolute inset-0 bg-gradient-to-t from-primary via-transparent to-transparent z-20 h-full w-full pointer-events-none rounded-2xl" />
                        <div className="aspect-[16/9] rounded-xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center relative">
                            {/* Video Demo */}
                            <video
                                src="/demo-video.mp4"
                                className="w-full h-full object-cover"
                                autoPlay
                                muted
                                loop
                                playsInline
                                poster="/hero-dashboard.png"
                            />
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* Features Section */}
            <section id="features" className="py-24 bg-secondary/30 relative">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-center mb-16"
                    >
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Por que escolher o FinElo?</h2>
                        <p className="text-gray-400 max-w-2xl mx-auto">Projetado para economizar seu tempo e trazer clareza financeira imediata.</p>
                    </motion.div>

                    <div className="grid md:grid-cols-3 gap-8">
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}>
                            <FeatureCard
                                icon={<UploadIcon className="h-8 w-8 text-accent" />}
                                title="Importação Inteligente"
                                description="Esqueça a digitação manual. Arraste seu extrato bancário (OFX ou CSV) e nós categorizamos tudo para você."
                            />
                        </motion.div>
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}>
                            <FeatureCard
                                icon={<DashboardIcon className="h-8 w-8 text-highlight" />}
                                title="Visão Clara"
                                description="Dashboards interativos que mostram exatamente onde você gasta mais e onde pode economizar."
                            />
                        </motion.div>
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }}>
                            <FeatureCard
                                icon={<TicketIcon className="h-8 w-8 text-pink-500" />}
                                title="Controle Simples"
                                description="Interface limpa e direta. Sem menus complicados ou termos financeiros difíceis."
                            />
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* Goals/Avatar Expansion Section */}
            <section className="py-24 relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-center"
                    >
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Projetado para seus Maiores Objetivos</h2>
                        <p className="text-gray-400 max-w-2xl mx-auto">Não importa se você está construindo seu patrimônio do zero, planejando comprar uma casa ou buscando uma aposentadoria tranquila.</p>
                    </motion.div>

                    <div className="grid md:grid-cols-3 gap-8">
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}>
                            <FeatureCard
                                icon={<ShieldCheckIcon className="h-8 w-8 text-blue-400" />}
                                title="Construção de Patrimônio"
                                description="Visualize a evolução do seu dinheiro mês a mês e tome decisões mais inteligentes para proteger o seu futuro."
                            />
                        </motion.div>
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}>
                            <FeatureCard
                                icon={<LockIcon className="h-8 w-8 text-green-400" />}
                                title="Segurança & Metas"
                                description="Crie tetos de gastos, corte onde não precisa e acelere sua entrada para o primeiro imóvel ou grandes conquistas."
                            />
                        </motion.div>
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }}>
                            <FeatureCard
                                icon={<LifebuoyIcon className="h-8 w-8 text-amber-400" />}
                                title="Aposentadoria e Liberdade"
                                description="Entenda suas médias de custo de vida real para calcular com exatidão quanto você precisa para ser livre financeiramente."
                            />
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* Family Plan Highlight Section */}
            <section className="py-24 bg-gradient-to-b from-primary to-secondary relative overflow-hidden border-t border-b border-white/5">
                <div className="absolute top-1/2 left-0 -translate-y-1/2 w-96 h-96 bg-accent/10 blur-[100px] rounded-full pointer-events-none" />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="flex flex-col lg:flex-row items-center gap-16">
                        <motion.div 
                            initial={{ opacity: 0, x: -30 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            className="flex-1 space-y-8"
                        >
                            <div className="inline-block px-4 py-2 rounded-full bg-accent/10 border border-accent/20 text-accent font-semibold text-sm mb-4">
                                Novidade Exclusiva
                            </div>
                            <h2 className="text-4xl md:text-5xl font-bold text-white leading-tight">
                                Mais clareza também <span className="text-accent">em Família</span>
                            </h2>
                            <p className="text-xl text-gray-300 leading-relaxed">
                                Casais e famílias que controlam o dinheiro juntos chegam aos seus objetivos 2x mais rápido.
                                <br /><br />
                                Com o <strong>Plano Família</strong> do FinElo, você convida seu parceiro(a) e ambos têm acesso ao mesmo painel unificado. Vejam saldo, gastos e metas de forma transparente e segura.
                            </p>
                            <ul className="space-y-4">
                                <li className="flex items-center gap-3 text-lg text-gray-300">
                                    <div className="h-2 w-2 rounded-full bg-accent" />
                                    Sem senhas compartilhadas (convites individuais)
                                </li>
                                <li className="flex items-center gap-3 text-lg text-gray-300">
                                    <div className="h-2 w-2 rounded-full bg-accent" />
                                    Visualização unificada de todas as contas
                                </li>
                            </ul>
                            <div className="pt-4">
                                <Link to="/login" className="inline-flex items-center px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold text-lg transition-all">
                                    Conhecer o Plano Família <ArrowsUpDownIcon className="ml-2 h-5 w-5" />
                                </Link>
                            </div>
                        </motion.div>
                        <motion.div 
                            initial={{ opacity: 0, x: 30 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            className="flex-1 relative"
                        >
                            <div className="relative z-10 bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl rotate-3 hover:rotate-0 transition-transform duration-500">
                                <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
                                    <div className="flex -space-x-4">
                                        <div className="h-12 w-12 rounded-full bg-blue-500 border-4 border-slate-900 flex items-center justify-center text-white font-bold">V</div>
                                        <div className="h-12 w-12 rounded-full bg-purple-500 border-4 border-slate-900 flex items-center justify-center text-white font-bold text-sm">C</div>
                                        <div className="h-12 w-12 rounded-full border-2 border-dashed border-gray-600 bg-slate-800 flex items-center justify-center text-gray-400 text-xs">+</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-gray-400">Saldo Familiar</div>
                                        <div className="text-xl font-bold text-white">R$ 12.450,00</div>
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <div className="h-2 bg-slate-800 rounded-full w-3/4" />
                                    <div className="h-2 bg-slate-800 rounded-full w-1/2" />
                                    <div className="h-2 bg-slate-800 rounded-full w-full" />
                                </div>
                            </div>
                            <div className="absolute top-10 -right-10 h-72 w-72 bg-purple-500/20 rounded-full blur-3xl -z-10" />
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* Testimonials (Prova Social) Section */}
            <section className="py-24 bg-primary relative">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-center mb-16"
                    >
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">O que dizem sobre nós</h2>
                        <p className="text-gray-400 max-w-2xl mx-auto">Histórias reais de quem transformou a própria vida financeira.</p>
                    </motion.div>

                    <div className="grid md:grid-cols-3 gap-6">
                        {testimonials.map((testimonial, idx) => (
                            <motion.div 
                                key={idx}
                                initial={{ opacity: 0, scale: 0.95 }}
                                whileInView={{ opacity: 1, scale: 1 }}
                                viewport={{ once: true }}
                                transition={{ delay: idx * 0.1 }}
                                className="p-8 rounded-3xl bg-secondary/30 border border-white/5 relative group hover:border-accent/30 transition-colors flex flex-col justify-between"
                            >
                                <svg className="absolute top-6 left-6 h-8 w-8 text-white/5 transform -scale-x-100 group-hover:text-accent/10 transition-colors" fill="currentColor" viewBox="0 0 32 32" aria-hidden="true">
                                    <path d="M9.352 4C4.456 7.456 1 13.12 1 19.36c0 5.088 3.072 8.064 6.624 8.064 3.36 0 5.856-2.688 5.856-5.856 0-3.168-2.208-5.472-5.088-5.472-.576 0-1.344.096-1.536.192.48-3.264 3.552-7.104 6.624-9.024L9.352 4zm16.512 0c-4.8 3.456-8.256 9.12-8.256 15.36 0 5.088 3.072 8.064 6.624 8.064 3.264 0 5.856-2.688 5.856-5.856 0-3.168-2.304-5.472-5.184-5.472-.576 0-1.248.096-1.44.192.48-3.264 3.456-7.104 6.528-9.024L25.864 4z" />
                                </svg>
                                <div className="relative z-10 mb-8 pt-4">
                                    <p className="text-gray-300 italic text-lg leading-relaxed">"{testimonial.quote}"</p>
                                </div>
                                <div className="flex items-center gap-4 mt-auto">
                                    <div className="h-12 w-12 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-lg border border-accent/30 shrink-0">
                                        {testimonial.initials}
                                    </div>
                                    <div>
                                        <div className="text-white font-bold">{testimonial.name}</div>
                                        <div className="text-accent text-sm">{testimonial.role}</div>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            <section className="py-24 relative overflow-hidden bg-secondary/20">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-center mb-16"
                    >
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Escolha seu Plano</h2>
                        <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-bold">
                            <ShieldCheckIcon className="h-4 w-4" />
                            7 Dias de Garantia Incondicional
                        </div>
                        <p className="text-gray-400 mb-8">Investimento irrisório perto da economia e da paz de espírito que você terá.</p>

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
                    </motion.div>

                    <div className="grid md:grid-cols-4 gap-6 max-w-7xl mx-auto items-center">
                        {/* Free Plan */}
                        <motion.div whileHover={{ y: -5 }} className="rounded-3xl p-8 bg-secondary/40 border border-white/5 backdrop-blur-sm order-2 md:order-1 opacity-80 hover:opacity-100 transition-opacity">
                            <h3 className="text-2xl font-bold text-white mb-2">Basic</h3>
                            <div className="text-4xl font-bold text-white mb-6">Grátis</div>
                            <ul className="space-y-4 mb-8 text-gray-300 text-sm">
                                <li className="flex items-center gap-2"><CheckIcon /> 1 Importação mensal</li>
                                <li className="flex items-center gap-2"><CheckIcon /> Dashboard Resumido</li>
                                <li className="flex items-center gap-2"><CheckIcon /> Acesso Individual</li>
                            </ul>
                            <Link to="/login" className="block w-full py-3 rounded-xl bg-white/10 text-white font-semibold text-center hover:bg-white/20 transition-colors">
                                Criar Conta
                            </Link>
                        </motion.div>

                        {/* PRO/Annual Plan */}
                        <motion.div whileHover={{ y: -5 }} className="rounded-3xl p-8 bg-secondary/40 border border-white/10 backdrop-blur-sm order-3 md:order-2 hover:border-accent/50 transition-colors">
                            <h3 className="text-2xl font-bold text-white mb-2">PRO {isMonthly ? 'Mensal' : 'Anual'}</h3>
                            <div className="text-4xl font-bold text-white mb-1"><span className="text-2xl">R$</span> {isMonthly ? '14,90' : '9,99'}<span className="text-lg text-gray-500 font-normal">/mês</span></div>
                            {isMonthly ? (
                                <p className="text-sm text-gray-400 mb-6 font-semibold">Cobrado R$ 14,90 por mês</p>
                            ) : (
                                <p className="text-sm text-green-400 mb-6 font-semibold">Cobrado R$ 119,90 por ano</p>
                            )}

                            <ul className="space-y-4 mb-8 text-gray-300 text-sm">
                                <li className="flex items-center gap-2"><CheckIcon /> Importações Ilimitadas</li>
                                <li className="flex items-center gap-2"><CheckIcon /> Plano Família Opcional (+R$4,90/conta)</li>
                                <li className="flex items-center gap-2"><CheckIcon /> Dashboard Completo & IA</li>
                            </ul>
                            <Link to="/login" className="block w-full py-4 rounded-xl bg-white/10 text-white font-bold text-lg text-center hover:bg-white/20 transition-all">
                                Assinar PRO
                            </Link>
                        </motion.div>

                        {/* Wealth Plan */}
                        <motion.div whileHover={{ y: -5 }} className="rounded-3xl p-8 bg-secondary/40 border border-purple-500/20 backdrop-blur-sm order-4 md:order-3 hover:border-purple-500/50 transition-colors">
                            <h3 className="text-2xl font-bold text-white mb-2">Wealth {isMonthly ? 'Mensal' : 'Anual'}</h3>
                            <div className="text-4xl font-bold text-white mb-1"><span className="text-2xl">R$</span> {isMonthly ? '29,90' : '19,90'}<span className="text-lg text-gray-500 font-normal">/mês</span></div>
                            {isMonthly ? (
                                <p className="text-sm text-purple-400 mb-6 font-semibold opacity-0">Espaçador</p>
                            ) : (
                                <p className="text-sm text-purple-400 mb-6 font-semibold">Cobrado R$ 238,80 por ano</p>
                            )}

                            <ul className="space-y-4 mb-8 text-gray-300 text-sm">
                                <li className="flex items-center gap-2"><CheckIcon /> <strong>Tudo do PRO</strong></li>
                                <li className="flex items-center gap-2"><CheckIcon /> <strong>Módulo de Investimentos e Cotações</strong></li>
                                <li className="flex items-center gap-2"><CheckIcon /> 1 Vaga Família Inclusa</li>
                            </ul>
                            <Link to="/login" className="block w-full py-4 rounded-xl bg-purple-600/20 border border-purple-600 text-purple-300 font-bold text-lg text-center hover:bg-purple-600 hover:text-white transition-all">
                                Assinar Wealth
                            </Link>
                        </motion.div>

                        {/* Lifetime Plan */}
                        <motion.div whileHover={{ scale: 1.05 }} className="rounded-3xl p-8 bg-gradient-to-b from-purple-900 to-slate-900 border-2 border-purple-500 shadow-2xl relative overflow-hidden transform md:scale-105 z-10 order-1 md:order-4 group">
                            <div className="absolute top-0 right-0 bg-purple-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider">OFERTA ÚNICA</div>
                            <h3 className="text-2xl font-bold text-white mb-2">Founder's Pack</h3>
                            <div className="text-4xl font-bold text-white mb-1"><span className="text-2xl">R$</span> 149,00</div>
                            <p className="text-sm text-purple-300 mb-6 font-semibold">Pagamento Único (Vitalício)</p>
                            <ul className="space-y-4 mb-8 text-white text-sm">
                                <li className="flex items-center gap-2"><CheckIcon color="text-purple-400" /> <strong>Acesso Vitalício ao APP</strong></li>
                                <li className="flex items-center gap-2"><CheckIcon color="text-purple-400" /> <strong>Todos os recursos Wealth</strong></li>
                                <li className="flex items-center gap-2"><CheckIcon color="text-purple-400" /> 1 Vaga Família Inclusa</li>
                                <li className="flex items-center gap-2"><CheckIcon color="text-purple-400" /> Selo "Founder" Exclusivo</li>
                            </ul>
                            <div className="flex justify-center mb-6">
                                <div className="px-3 py-1 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-bold uppercase tracking-wider">
                                    7 Dias de Garantia
                                </div>
                            </div>
                            <Link 
                                to={`/login?${promoCode ? `promo=${promoCode}` : ''}`} 
                                className="block w-full py-4 rounded-xl bg-purple-600 text-white font-bold text-lg text-center hover:bg-purple-500 shadow-lg shadow-purple-500/25 transition-all group-hover:shadow-purple-500/50"
                            >
                                Garantir Acesso Vitalício
                            </Link>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-12 border-t border-white/5 text-center text-gray-500 text-sm">
                <div className="flex justify-center gap-6 mb-8">
                    <a href="https://www.instagram.com/finelo_oficial/" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-accent transition-colors" aria-label="Instagram">
                        <InstagramIcon className="h-6 w-6" />
                    </a>
                    <a href="https://www.facebook.com/profile.php?id=61586610943211" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-accent transition-colors" aria-label="Facebook">
                        <FacebookIcon className="h-6 w-6" />
                    </a>
                    <a href="https://wa.me/5511981967070" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-accent transition-colors" aria-label="WhatsApp">
                        <WhatsappIcon className="h-6 w-6" />
                    </a>
                </div>
                <p>© 2026 FinElo. Todos os direitos reservados. Feito para desbravar seu futuro financeiro.</p>
                <div className="flex justify-center gap-6 mt-4">
                    <button onClick={() => setShowTerms(true)} className="hover:text-white transition-colors bg-transparent border-none cursor-pointer">Termos de Uso</button>
                    <button onClick={() => setShowTerms(true)} className="hover:text-white transition-colors bg-transparent border-none cursor-pointer">Privacidade</button>
                    <a href="mailto:suporte@finelo.app.br" className="hover:text-white transition-colors">Fale com o Suporte</a>
                </div>
            </footer>

            {/* WhatsApp FAB Flutuante */}
            <a 
                href="https://wa.me/5511981967070" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="fixed bottom-6 right-6 bg-[#25D366] text-white p-4 rounded-full shadow-[0_0_20px_rgba(37,211,102,0.5)] hover:bg-[#20b858] hover:scale-110 transition-all z-50 flex items-center justify-center group border border-white/20"
                aria-label="Fale conosco no WhatsApp"
            >
                <WhatsappIcon className="h-8 w-8" />
                <span className="absolute right-full mr-4 bg-white text-slate-800 text-sm font-bold py-2 px-4 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-xl pointer-events-none border border-slate-100">
                    Dúvidas? Fale com um Especialista
                </span>
            </a>

            <TermsModal isOpen={showTerms} onClose={() => setShowTerms(false)} />
        </div>
    );
};

const FeatureCard = ({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) => (
    <div className="p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors group h-full">
        <div className="mb-4 p-3 bg-white/5 rounded-xl inline-block group-hover:scale-110 transition-transform duration-300">
            {icon}
        </div>
        <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
        <p className="text-gray-400 leading-relaxed text-sm">
            {description}
        </p>
    </div>
);

const CheckIcon = ({ color = "text-gray-400" }) => (
    <svg className={`w-5 h-5 ${color} flex-shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
);

export default LandingPage;
