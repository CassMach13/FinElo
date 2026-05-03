import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { UploadIcon, DashboardIcon, LifebuoyIcon, TicketIcon, ArrowsUpDownIcon, SettingsIcon, LockIcon, ShieldCheckIcon, InstagramIcon, FacebookIcon, WhatsappIcon, YoutubeIcon } from '../ui/icons';
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
            navigate(`/login?view=signup&email=${encodeURIComponent(email)}${extra}`);
        } else {
            navigate(`/login?view=signup${extra}`);
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
                            <Link to={`/login?view=login${promoCode ? `&promo=${promoCode}` : ''}`} className="text-sm font-medium text-gray-300 hover:text-white transition-colors">
                                Entrar
                            </Link>
                            <Link
                                to={`/login?view=signup${promoCode ? `&promo=${promoCode}` : ''}`}
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
                                title="Automação em 1 Clique"
                                description="Importe seus extratos do PicPay, Itaú e outros bancos em segundos. O FinElo categoriza tudo automaticamente, eliminando horas de digitação manual."
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
                                icon={<LifebuoyIcon className="h-8 w-8 text-pink-500" />}
                                title="Diagnóstico 50-30-20"
                                description="Saiba em tempo real se você está gastando demais com estilo de vida ou se está no caminho certo para a liberdade financeira."
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
                                title="Patrimônio Líquido Real"
                                description="Acompanhe seus bens e dívidas (financiamentos) em um só lugar. Entenda o quanto você realmente vale e veja seu império crescer."
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
                                <Link to="/login?view=signup" className="inline-flex items-center px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold text-lg transition-all">
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

            {/* Guarantee / Trust Section */}
            <section className="py-16 relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="flex flex-col lg:flex-row items-center justify-between gap-12 bg-secondary/20 backdrop-blur-md rounded-[40px] p-8 md:p-16 border border-white/10 shadow-2xl relative"
                    >
                        <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 blur-[100px] rounded-full -z-10" />
                        
                        {/* Lado Esquerdo: O "7" Gigante */}
                        <div className="flex flex-col items-center justify-center text-center space-y-4 shrink-0">
                            <div className="relative">
                                <span className="text-[140px] md:text-[180px] font-black leading-none bg-clip-text text-transparent bg-gradient-to-br from-white to-white/10 select-none">
                                    7
                                </span>
                                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex gap-1">
                                    {[1, 2, 3, 4, 5].map((s) => (
                                        <svg key={s} className="w-6 h-6 md:w-8 md:h-8 text-amber-500 fill-current drop-shadow-lg" viewBox="0 0 20 20">
                                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                        </svg>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-col pt-4">
                                <span className="text-4xl font-black text-white tracking-[0.2em] uppercase">Dias</span>
                                <span className="text-accent font-bold tracking-tight text-lg">Garantia Incondicional</span>
                            </div>
                        </div>

                        {/* Lado Direito: O Texto e Trust Badges */}
                        <div className="flex-1 space-y-10">
                            <div className="space-y-6">
                                <h2 className="text-3xl md:text-5xl font-bold text-white leading-tight">
                                    Sua Segurança é <br className="hidden md:block" />
                                    <span className="text-accent">Garantida por Lei</span>
                                </h2>
                                <p className="text-xl text-gray-300 leading-relaxed max-w-2xl text-balance">
                                    No FinElo, levamos sua privacidade e seus direitos a sério. Em total conformidade com o <strong className="text-white border-b-2 border-accent/30 pb-1">Artigo 49 do Código de Defesa do Consumidor</strong>, garantimos o seu direito de arrependimento.
                                </p>
                                <p className="text-gray-400 text-lg leading-relaxed">
                                    Teste todas as ferramentas, importe seus dados e sinta a diferença na sua gestão. Se por qualquer motivo não for o que você esperava, devolvemos 100% do seu investimento sem perguntas e sem letras miúdas.
                                </p>
                            </div>

                            {/* Badges de Confiança */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="flex items-center gap-4 p-5 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                                    <div className="p-2 rounded-xl bg-accent/20">
                                        <LockIcon className="h-6 w-6 text-accent" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-white uppercase tracking-wider">Checkout</span>
                                        <span className="text-sm text-gray-400">100% Seguro</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 p-5 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                                    <div className="p-2 rounded-xl bg-highlight/20">
                                        <ShieldCheckIcon className="h-6 w-6 text-highlight" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-white uppercase tracking-wider">Privacidade</span>
                                        <span className="text-sm text-gray-400">Dados Protegidos</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 p-5 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                                    <div className="p-2 rounded-xl bg-green-500/20">
                                        <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-white uppercase tracking-wider">Satisfação</span>
                                        <span className="text-sm text-gray-400">Garantida</span>
                                    </div>
                                </div>
                            </div>

                            {/* Métodos de Pagamento e Selos */}
                            <div className="flex flex-wrap items-center gap-6 pt-6 border-t border-white/5 justify-center lg:justify-start">
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mr-2">Pague com</span>
                                <div className="flex flex-wrap items-center gap-x-8 gap-y-4 justify-center lg:justify-start">
                                    <VisaIcon className="h-4 w-auto drop-shadow-sm" />
                                    <MastercardIcon className="h-7 w-auto drop-shadow-sm" />
                                    <ApplePayIcon className="h-6 w-auto drop-shadow-sm" />
                                    <GooglePayIcon className="h-5 w-auto drop-shadow-sm" />
                                    <BoletoIcon className="h-6 w-auto drop-shadow-sm" />
                                </div>
                            </div>
                        </div>
                    </motion.div>
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
                            <Link to="/login?view=signup" className="block w-full py-3 rounded-xl bg-white/10 text-white font-semibold text-center hover:bg-white/20 transition-colors">
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
                            <div className="flex justify-center mb-6">
                                <div className="px-3 py-1 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-bold uppercase tracking-wider">
                                    7 Dias de Garantia
                                </div>
                            </div>
                            <Link to="/login?view=signup" className="block w-full py-4 rounded-xl bg-white/10 text-white font-bold text-lg text-center hover:bg-white/20 transition-all">
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
                            <div className="flex justify-center mb-6">
                                <div className="px-3 py-1 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-bold uppercase tracking-wider">
                                    7 Dias de Garantia
                                </div>
                            </div>
                            <Link to="/login?view=signup" className="block w-full py-4 rounded-xl bg-purple-600/20 border border-purple-600 text-purple-300 font-bold text-lg text-center hover:bg-purple-600 hover:text-white transition-all">
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
                    <a href="https://www.youtube.com/@FinElo_Oficial" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-accent transition-colors" aria-label="YouTube">
                        <YoutubeIcon className="h-6 w-6" />
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

const VisaIcon = ({ className = "" }) => (
    <svg className={className} viewBox="0 0 1000 325" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M651.185.5c-70.933 0-134.322 36.766-134.322 104.694 0 77.9 112.423 83.28 112.423 122.415 0 16.478-18.884 31.229-51.137 31.229-45.773 0-79.984-20.611-79.984-20.611l-14.638 68.547s39.41 17.41 91.734 17.41c77.552 0 138.576-38.572 138.576-107.66 0-82.316-112.89-87.537-112.89-123.86 0-12.91 15.501-27.053 47.662-27.053 36.286 0 65.892 14.99 65.892 14.99l14.326-66.204S696.614.5 651.185.5zM2.218 5.497L.5 15.49s29.842 5.461 56.719 16.356c34.606 12.492 37.072 19.765 42.9 42.353l63.51 244.832h85.138L379.927 5.497h-84.942L210.707 218.67l-34.39-180.696c-3.154-20.68-19.13-32.477-38.685-32.477H2.218zm411.865 0L347.449 319.03h80.999l66.4-313.534h-80.765zm451.759 0c-19.532 0-29.88 10.457-37.474 28.73L709.699 319.03h84.942l16.434-47.468h103.483l9.994 47.468H999.5L934.115 5.497h-68.273zm11.047 84.707l25.178 117.653h-67.454z" fill="#1434cb"/>
    </svg>
);

const ApplePayIcon = ({ className = "" }) => (
    <svg className={className} viewBox="-2.48 135.79 499.389 229.888" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="m131.82 230.99c.3 27.1 24.6 36.1 24.8 36.2-.2.6-3.9 12.9-12.8 25.5-7.7 10.9-15.7 21.8-28.3 22-12.4.2-16.4-7.1-30.5-7.1-14.2 0-18.6 6.9-30.3 7.3-12.2.4-21.4-11.8-29.2-22.7-15.9-22.2-28-62.8-11.7-90.2 8.1-13.6 22.6-22.2 38.3-22.5 11.9-.2 23.2 7.8 30.5 7.8s21-9.6 35.4-8.2c6 .2 23 2.4 33.8 17.8-.9.5-20.2 11.4-20 34.1m-23.3-66.6c6.5-7.6 10.8-18.1 9.6-28.6-9.3.4-20.6 6-27.2 13.6-6 6.7-11.2 17.4-9.8 27.7 10.4.8 21-5.1 27.4-12.7m93.551-12.985c4.756-.79 10.118-1.483 15.886-2.175s12.141-.593 19.021-.593c9.916 0 18.415 1.186 25.599 3.46 7.184 2.371 13.052 5.633 17.706 10.08 3.946 3.855 7.083 8.5 9.309 13.738 2.226 5.337 3.339 11.465 3.339 18.383 0 8.401-1.518 15.715-4.553 22.04s-7.184 11.564-12.445 15.814-11.535 7.413-18.82 9.587c-7.285 2.075-15.177 3.163-23.777 3.163-7.79 0-14.266-.593-19.528-1.68v69.579h-11.635v-161.001zm11.636 81.241c2.833.791 5.97 1.384 9.41 1.68s7.183.495 11.13.495c14.873 0 26.306-3.36 34.502-10.18 8.195-6.72 12.242-16.703 12.242-29.75 0-6.325-1.112-11.76-3.237-16.406s-5.16-8.5-9.106-11.464-8.702-5.239-14.064-6.721c-5.464-1.483-11.434-2.273-18.112-2.273-5.26 0-9.814.197-13.659.593s-6.88.89-9.106 1.285zm171.702 52.184c0 4.646.101 9.39.202 14.035.203 4.646.708 9.192 1.518 13.54h-10.927l-1.72-16.405h-.506c-1.518 2.273-3.34 4.547-5.667 6.72a41.22 41.22 0 0 1 -7.993 6.129c-3.035 1.877-6.475 3.36-10.421 4.447-3.845 1.087-8.095 1.68-12.749 1.68-5.767 0-10.826-.89-15.177-2.767s-7.993-4.25-10.725-7.215c-2.833-2.965-4.958-6.424-6.273-10.279-1.416-3.854-2.125-7.709-2.125-11.563 0-13.738 5.869-24.215 17.707-31.627s29.544-10.97 53.321-10.674v-3.163c0-3.064-.303-6.523-.91-10.476s-1.821-7.71-3.845-11.267-4.958-6.524-8.904-8.896-9.308-3.656-16.087-3.656c-5.16 0-10.22.79-15.177 2.273a49.895 49.895 0 0 0 -13.76 6.424l-3.744-8.5c5.26-3.558 10.725-6.029 16.29-7.61 5.564-1.483 11.433-2.273 17.605-2.273 8.296 0 14.974 1.384 20.134 4.15s9.309 6.326 12.243 10.675 4.958 9.192 6.071 14.627 1.619 10.773 1.619 16.11zm-11.636-34.492c-6.273-.198-12.85.099-19.629.692-6.88.691-13.153 2.075-18.92 4.25s-10.523 5.337-14.368 9.586c-3.743 4.151-5.666 9.785-5.666 16.703 0 8.204 2.429 14.232 7.184 18.087s10.118 5.831 16.088 5.831c4.755 0 9.106-.692 12.85-1.976s7.082-3.064 9.915-5.239 5.16-4.645 7.082-7.412 3.34-5.535 4.351-8.5c.81-3.261 1.214-5.535 1.214-7.017zm34.3-53.964 30.152 75.41c1.618 4.152 3.237 8.5 4.755 12.948s2.833 8.5 3.946 12.255h.506c1.113-3.558 2.428-7.51 3.946-11.958s3.137-8.994 4.958-13.64l28.229-74.916h12.344l-34.401 85.096c-3.44 8.994-6.78 17.198-9.815 24.511s-6.172 13.936-9.308 19.866-6.273 11.07-9.511 15.616-6.78 8.5-10.725 11.86c-4.654 4.052-8.904 7.017-12.749 8.796-3.845 1.878-6.475 3.064-7.79 3.46l-3.947-9.39c2.935-1.285 6.274-2.965 9.916-5.04s7.184-4.843 10.624-8.204c2.934-2.866 6.273-6.72 9.814-11.465s6.678-10.476 9.511-17.296c1.012-2.57 1.518-4.25 1.518-5.04 0-1.087-.506-2.866-1.518-5.04l-42.798-107.533h12.344z" fill="white"/>
    </svg>
);

const GooglePayIcon = ({ className = "" }) => (
    <svg className={className} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        <path d="M242,253.46v59.5h-19.19V165.81h49.91c12.15,0,23.66,4.47,32.63,12.79c8.96,7.67,13.44,19.19,13.44,31.35s-4.47,23.03-13.44,31.35c-8.96,8.32-19.83,12.79-32.63,12.79L242,253.46z M242,183.72v51.19h32c7.04,0,14.08-2.57,18.56-7.67c10.24-9.59,10.24-25.59,0.63-35.19l-0.63-0.65c-5.12-5.12-11.52-8.32-18.56-7.67H242z" fill="white"/>
        <path d="M362.93,209.32c14.08,0,24.95,3.83,33.27,11.52c8.32,7.67,12.15,17.91,12.15,30.71v61.43h-17.91v-14.08h-0.63c-7.67,11.52-18.56,17.28-31.35,17.28c-10.87,0-20.48-3.2-28.15-9.59c-7.04-6.4-11.52-15.36-11.52-24.95c0-10.24,3.84-18.54,11.52-24.95c7.67-6.4,18.54-8.96,31.35-8.96c11.52,0,20.48,1.92,27.51,6.4v-4.47c0-6.4-2.55-12.79-7.67-16.64c-5.12-4.47-11.52-7.04-18.56-7.04c-10.87,0-19.19,4.47-24.95,13.44l-16.64-10.24C331.58,215.71,345.02,209.32,362.93,209.32z M338.62,282.25c0,5.12,2.55,9.59,6.4,12.15c4.47,3.2,9.59,5.12,14.71,5.12c7.67,0,15.36-3.2,21.11-8.95c6.4-5.77,9.59-12.79,9.59-20.48c-5.75-4.47-14.08-7.04-24.95-7.04c-7.67,0-14.08,1.92-19.19,5.75C341.17,272.01,338.62,276.49,338.62,282.25z" fill="white"/>
        <polygon points="512,212.52 448.67,357.74 429.46,357.74 453.14,307.2 411.55,213.15 432.03,213.15 462.09,285.44 462.73,285.44 492.16,213.15 512,213.15" fill="white"/>
        <path d="M165.88,240.67c0-5.77-0.65-11.52-1.28-17.28H84.63v32.63h45.42c-1.92,10.24-7.67,19.83-16.64,25.59v21.11h27.51C156.91,288.01,165.88,266.25,165.88,240.67z" fill="#4285F4"/>
        <path d="M84.61,323.19c23.03,0,42.22-7.67,56.31-20.48l-27.51-21.11c-7.67,5.12-17.28,8.32-28.78,8.32c-21.76,0-40.95-14.71-47.34-35.19H9.12v21.76C23.83,305.28,52.63,323.19,84.61,323.19z" fill="#34A853"/>
        <path d="M37.27,254.74c-3.84-10.24-3.84-21.76,0-32.63v-21.76H9.12c-12.16,23.68-12.16,51.83,0,76.14L37.27,254.74z" fill="#FBBC04"/>
        <path d="M84.61,187.56c12.16,0,23.68,4.47,32.63,12.79l24.32-24.31c-15.36-14.07-35.83-22.39-56.31-21.76c-32,0-61.41,17.91-75.49,46.71l28.15,21.74C43.67,202.28,62.86,187.56,84.61,187.56z" fill="#EA4335"/>
    </svg>
);
const MastercardIcon = ({ className = "" }) => (
    <svg className={className} viewBox="0 0 40 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="16" r="12" fill="#EB001B" />
        <circle cx="28" cy="16" r="12" fill="#F79E1B" fillOpacity="1" />
        <path d="M20 16a11.977 11.977 0 014.125-9.155A11.977 11.977 0 0120 25.155a11.977 11.977 0 01-4.125-9.155c0-3.564 1.55-6.764 4.125-9.155z" fill="#FF5F00" />
    </svg>
);

const PixIcon = ({ className = "" }) => (
    <svg className={className} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M43.8 12.4c1.8-1.8 4.7-1.8 6.5 0l37.3 37.3c1.8 1.8 1.8 4.7 0 6.5L50.3 93.5c-1.8 1.8-4.7 1.8-6.5 0L6.5 56.2c-1.8-1.8-1.8-4.7 0-6.5l37.3-37.3zM50 82.1l32.1-32.1L50 17.9 17.9 50 50 82.1zm5.7-41.9L50 45.9l-5.7-5.7c-1.6-1.6-4.1-1.6-5.7 0l-5.7 5.7c-1.6 1.6-1.6 4.1 0 5.7l5.7 5.7 5.7 5.7 5.7-5.7 5.7-5.7c1.6-1.6 1.6-4.1 0-5.7L61.4 40.2c-1.6-1.6-4.1-1.6-5.7 0z" fill="#32BCAD" />
    </svg>
);

const BoletoIcon = ({ className = "" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="24" height="24" rx="4" fill="#334155" fillOpacity="0.2"/>
        <path d="M4 7V17H5V7H4ZM6 7V17H8V7H6ZM9 7V17H10V7H9ZM11 7V17H12V7H11ZM13 7V17H15V7H13ZM16 7V17H17V7H16ZM18 7V17H20V7H18Z" fill="white"/>
        <path d="M4 18H20V20H4V18Z" fill="white" opacity="0.5"/>
    </svg>
);

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
