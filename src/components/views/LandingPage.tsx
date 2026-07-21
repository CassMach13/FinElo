import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowsUpDownIcon, LockIcon, ShieldCheckIcon, InstagramIcon, FacebookIcon, WhatsappIcon, YoutubeIcon } from '../ui/icons';
import TermsModal from '../modals/TermsModal';
import { useAppStore } from '../../hooks/useAppStore';

const testimonials = [
    {
        name: 'João Silva',
        role: 'Empresário, 35',
        initials: 'JS',
        quote:
            'Antes eu perdia horas conferindo faturas e extratos de 3 bancos diferentes. O FinElo resolve isso em 2 minutos. Foi um divisor de águas.',
    },
    {
        name: 'Maria Costa',
        role: 'Médica, 42',
        initials: 'MC',
        quote:
            'O plano família é sensacional. Acabaram as discussões no fim do mês sobre quem gastou com o quê. Tudo transparente e numa tela só.',
    },
    {
        name: 'Pedro Alves',
        role: 'Engenheiro, 29',
        initials: 'PA',
        quote:
            'Estou juntando para comprar meu primeiro apartamento. Ver a evolução do patrimônio todo mês com os gráficos do FinElo me dá motivação extra.',
    },
];

const fadeUp = (reduce: boolean | null, delay = 0) =>
    reduce
        ? { initial: false as const, animate: undefined, transition: undefined }
        : {
              initial: { opacity: 0, y: 20 },
              animate: { opacity: 1, y: 0 },
              transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] as const },
          };

const LandingPage: React.FC = () => {
    const [showTerms, setShowTerms] = useState(false);
    const [isMonthly, setIsMonthly] = useState(false);
    const [email, setEmail] = useState('');
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const promoCode = searchParams.get('promo') || searchParams.get('coupon');
    const { founderCount, fetchFounderCount } = useAppStore();
    const reduceMotion = useReducedMotion();

    useEffect(() => {
        fetchFounderCount();
    }, [fetchFounderCount]);

    const remainingSpots = Math.max(0, 50 - founderCount);
    const isSoldOut = remainingSpots <= 0;

    const handleGetStarted = (e: React.FormEvent) => {
        e.preventDefault();
        const extra = promoCode ? `&promo=${promoCode}` : '';
        if (email) {
            navigate(`/login?view=signup&email=${encodeURIComponent(email)}${extra}`);
        } else {
            navigate(`/login?view=signup${extra}`);
        }
    };

    const signupHref = `/login?view=signup${promoCode ? `&promo=${promoCode}` : ''}`;
    const loginHref = `/login?view=login${promoCode ? `&promo=${promoCode}` : ''}`;

    return (
        <div className="min-h-screen bg-primary text-light font-landing selection:bg-accent selection:text-white">
            {/* Atmosfera base */}
            <div
                className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
                aria-hidden="true"
            >
                <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-accent/[0.07] blur-[100px]" />
                <div className="absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-highlight/[0.04] blur-[90px]" />
            </div>

            <nav className="fixed z-50 w-full border-b border-white/[0.06] bg-primary/85 backdrop-blur-md">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    <a href="#topo" className="flex items-center gap-3" aria-label="FinElo — início">
                        <img
                            src="/logo/Image_fx.png"
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-lg object-cover"
                            width={40}
                            height={40}
                            aria-hidden="true"
                        />
                        <span className="text-xl font-bold tracking-tight text-white/90">FinElo</span>
                    </a>
                    <div className="flex items-center gap-3 sm:gap-4">
                        <Link
                            to={loginHref}
                            className="text-sm font-medium text-gray-400 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                            Entrar
                        </Link>
                        <Link
                            to={signupHref}
                            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                            Começar grátis
                        </Link>
                    </div>
                </div>
            </nav>

            {/* ——— Hero ——— */}
            <section id="topo" className="relative overflow-hidden pt-28 pb-16 lg:pt-36 lg:pb-24">
                <div className="mx-auto grid max-w-7xl items-end gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:gap-10 lg:px-8">
                    <div className="lg:col-span-5 lg:pb-8">
                        <motion.h1
                            {...fadeUp(reduceMotion, 0)}
                            className="text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[3.25rem]"
                        >
                            Veja para onde vai o seu dinheiro —{' '}
                            <span className="text-teal-300">sem planilha</span>
                        </motion.h1>
                        <motion.p
                            {...fadeUp(reduceMotion, 0.12)}
                            className="mt-6 max-w-md text-lg leading-relaxed text-gray-400"
                        >
                            Importe extratos, entenda entradas e saídas, e acompanhe patrimônio e metas — sozinho ou em família.
                        </motion.p>

                        <motion.form
                            {...fadeUp(reduceMotion, 0.2)}
                            onSubmit={handleGetStarted}
                            className="mt-8 flex max-w-md flex-col gap-3 sm:flex-row sm:items-stretch"
                        >
                            <label className="sr-only" htmlFor="hero-email">
                                Seu e-mail
                            </label>
                            <input
                                id="hero-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Seu e-mail"
                                required
                                className="min-h-[52px] flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-white placeholder-gray-500 transition focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/40"
                            />
                            <button
                                type="submit"
                                className="min-h-[52px] rounded-lg bg-accent px-6 text-base font-bold text-white transition hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                Criar conta grátis
                            </button>
                        </motion.form>

                        {promoCode && (
                            <p className="mt-4 text-sm text-green-400">
                                Cupom <strong>{promoCode}</strong> será aplicado na assinatura.
                            </p>
                        )}

                        <p className="mt-5 text-sm text-gray-500">
                            Plano Basic gratuito · 7 dias de garantia nos planos pagos
                        </p>
                    </div>

                    <motion.div
                        {...(reduceMotion
                            ? {}
                            : {
                                  initial: { opacity: 0, y: 28 },
                                  animate: { opacity: 1, y: 0 },
                                  transition: { duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] },
                              })}
                        className="relative lg:col-span-7"
                    >
                        <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-accent/15 via-transparent to-highlight/10 blur-2xl" />
                        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-secondary/40 shadow-2xl shadow-black/40">
                            <img
                                src="/landing/dashboard-principal.png"
                                alt="Dashboard FinElo com resumo de entradas, saídas e investimentos"
                                className="w-full object-cover object-top"
                                width={1200}
                                height={675}
                                fetchPriority="high"
                            />
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* ——— Momento mágico: Importar → Entender → Decidir ——— */}
            <section className="border-t border-white/[0.04] py-24">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="max-w-2xl">
                        <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                            Do extrato à clareza
                        </h2>
                        <p className="mt-4 text-lg text-gray-400">
                            Três passos. Sem digitar linha a linha.
                        </p>
                    </div>

                    <ol className="mt-16 space-y-20">
                        <EditorialStep
                            step="01"
                            title="Importe"
                            description="Selecione o banco ou cartão e traga o extrato. Categorização automática — sem horas na planilha."
                            imageSrc="/landing/importar.png"
                            imageAlt="Tela de importação de extratos com bancos favoritos e importação automática"
                            reduceMotion={reduceMotion}
                        />
                        <EditorialStep
                            step="02"
                            title="Entenda"
                            description="Veja o diagnóstico 50-30-20: necessidades, estilo de vida e investimentos — com o que ultrapassou a meta em evidência."
                            imageSrc="/landing/dashboard-clareza.png"
                            imageAlt="Método 50-30-20 de saúde financeira no dashboard FinElo"
                            reverse
                            reduceMotion={reduceMotion}
                        />
                        <EditorialStep
                            step="03"
                            title="Decida"
                            description="Patrimônio consolidado: contas, investimentos e bens — menos o financiamento. Saiba quanto você realmente vale."
                            imageSrc="/landing/patrimonio.png"
                            imageAlt="Painel de patrimônio total com distribuição por liquidez"
                            reduceMotion={reduceMotion}
                        />
                    </ol>
                </div>
            </section>

            {/* ——— Clareza (âncora visual) ——— */}
            <section className="bg-secondary/25 py-24">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
                        <motion.div
                            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                            whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-80px' }}
                            transition={{ duration: 0.5 }}
                        >
                            <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                                Clareza no lugar do caos
                            </h2>
                            <p className="mt-5 text-lg leading-relaxed text-gray-400">
                                Entradas, saídas e resultado operacional no mesmo painel. Compare períodos, exporte PDF e saiba se o mês fechou no azul — ou o que precisa mudar.
                            </p>
                            <ul className="mt-8 space-y-3 text-gray-300">
                                {[
                                    'Resumo operacional sem misturar investimento com gasto do dia a dia',
                                    'Metas e tetos de gasto por categoria',
                                    'Diagnóstico 50-30-20 em tempo real',
                                ].map((item) => (
                                    <li key={item} className="flex gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </motion.div>
                        <motion.div
                            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                            whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-80px' }}
                            transition={{ duration: 0.5, delay: 0.08 }}
                            className="overflow-hidden rounded-2xl border border-white/10 shadow-xl shadow-black/30"
                        >
                            <img
                                src="/landing/dashboard-principal.png"
                                alt="Cards de entradas, saídas, resultado e investimentos no FinElo"
                                className="w-full object-cover object-top"
                                loading="lazy"
                            />
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* ——— Família ——— */}
            <section className="border-t border-white/[0.04] py-24">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="grid items-center gap-14 lg:grid-cols-2">
                        <motion.div
                            initial={reduceMotion ? false : { opacity: 0, x: -20 }}
                            whileInView={reduceMotion ? undefined : { opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5 }}
                            className="space-y-6"
                        >
                            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
                                Plano Família
                            </p>
                            <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                                Mesmo painel. Contas individuais.
                            </h2>
                            <p className="text-lg leading-relaxed text-gray-400">
                                Convide seu parceiro(a) e compartilhem saldo, gastos e metas com transparência — sem trocar senha, com convites individuais.
                            </p>
                            <ul className="space-y-3 text-gray-300">
                                <li className="flex gap-3">
                                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                                    Sem senhas compartilhadas
                                </li>
                                <li className="flex gap-3">
                                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                                    Visão unificada das contas da casa
                                </li>
                            </ul>
                            <Link
                                to={signupHref}
                                className="inline-flex items-center gap-2 pt-2 text-base font-semibold text-accent transition hover:text-teal-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                Conhecer o Plano Família
                                <ArrowsUpDownIcon className="h-4 w-4 rotate-90" />
                            </Link>
                        </motion.div>
                        <motion.div
                            initial={reduceMotion ? false : { opacity: 0, x: 20 }}
                            whileInView={reduceMotion ? undefined : { opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5 }}
                            className="relative"
                        >
                            <div className="rounded-2xl border border-white/10 bg-secondary/40 p-8">
                                <div className="mb-8 flex items-center justify-between border-b border-white/10 pb-6">
                                    <div className="flex -space-x-3">
                                        <div className="flex h-11 w-11 items-center justify-center rounded-full border-4 border-secondary bg-blue-500 text-sm font-bold text-white">
                                            V
                                        </div>
                                        <div className="flex h-11 w-11 items-center justify-center rounded-full border-4 border-secondary bg-teal-600 text-sm font-bold text-white">
                                            C
                                        </div>
                                        <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-gray-600 bg-slate-800 text-xs text-gray-400">
                                            +
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-gray-500">Saldo familiar</div>
                                        <div className="text-xl font-bold text-white">R$ 12.450,00</div>
                                    </div>
                                </div>
                                <p className="text-sm leading-relaxed text-gray-400">
                                    Cada pessoa com o próprio acesso. Um só lugar para alinhar o mês — sem planilha compartilhada no Drive.
                                </p>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* ——— Depoimentos ——— */}
            <section className="bg-secondary/20 py-24">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="mb-12 max-w-2xl">
                        <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                            O que esperamos que você sinta
                        </h2>
                        <p className="mt-3 text-gray-400">
                            Exemplos ilustrativos — em breve, histórias de quem já usa o FinElo.
                        </p>
                    </div>
                    <div className="grid gap-6 md:grid-cols-3">
                        {testimonials.map((testimonial, idx) => (
                            <motion.blockquote
                                key={testimonial.name}
                                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                                whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: reduceMotion ? 0 : idx * 0.08, duration: 0.45 }}
                                className="flex flex-col justify-between border-l-2 border-accent/40 pl-6 py-2"
                            >
                                <p className="text-lg leading-relaxed text-gray-300">
                                    “{testimonial.quote}”
                                </p>
                                <footer className="mt-6 flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
                                        {testimonial.initials}
                                    </div>
                                    <div>
                                        <div className="font-semibold text-white">{testimonial.name}</div>
                                        <div className="text-sm text-gray-500">{testimonial.role}</div>
                                    </div>
                                </footer>
                            </motion.blockquote>
                        ))}
                    </div>
                </div>
            </section>

            {/* ——— Garantia ——— */}
            <section className="py-20">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <motion.div
                        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                        whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="flex flex-col items-start gap-10 border border-white/10 bg-secondary/20 p-8 md:flex-row md:items-center md:gap-16 md:p-12 lg:p-14"
                    >
                        <div className="shrink-0 text-center md:text-left">
                            <span className="block text-[7rem] font-black leading-none tracking-tighter text-white/90 md:text-[8rem]">
                                7
                            </span>
                            <span className="mt-1 block text-sm font-bold uppercase tracking-[0.25em] text-accent">
                                Dias de garantia
                            </span>
                        </div>
                        <div className="flex-1 space-y-5">
                            <h2 className="text-2xl font-bold text-white md:text-3xl">
                                Direito de arrependimento, sem letra miúda
                            </h2>
                            <p className="max-w-2xl text-lg leading-relaxed text-gray-400">
                                Em conformidade com o Artigo 49 do Código de Defesa do Consumidor: teste o FinElo, importe seus dados e, se não for o que esperava, reembolso integral em até 7 dias.
                            </p>
                            <div className="flex flex-wrap gap-6 pt-2 text-sm text-gray-400">
                                <span className="flex items-center gap-2">
                                    <LockIcon className="h-4 w-4 text-accent" /> Checkout seguro
                                </span>
                                <span className="flex items-center gap-2">
                                    <ShieldCheckIcon className="h-4 w-4 text-accent" /> Dados protegidos
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-6 border-t border-white/5 pt-6">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                                    Pague com
                                </span>
                                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                                    <VisaIcon className="h-3.5 w-auto" />
                                    <MastercardIcon className="h-6 w-auto" />
                                    <ApplePayIcon className="h-5 w-auto" />
                                    <GooglePayIcon className="h-4 w-auto" />
                                    <BoletoIcon className="h-5 w-auto" />
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* ——— Planos ——— */}
            <section className="border-t border-white/[0.04] bg-secondary/15 py-24">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="mb-14 text-center">
                        <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                            Escolha seu plano
                        </h2>
                        <p className="mx-auto mt-4 max-w-lg text-gray-400">
                            Comece no Basic. Evolua quando fizer sentido. 7 dias de garantia nos planos pagos.
                        </p>
                        <div className="mt-8 flex items-center justify-center gap-3">
                            <span className={`text-sm font-medium ${isMonthly ? 'text-white' : 'text-gray-500'}`}>
                                Mensal
                            </span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={!isMonthly}
                                aria-label="Alternar entre cobrança mensal e anual"
                                onClick={() => setIsMonthly(!isMonthly)}
                                className="relative inline-flex h-8 w-14 items-center rounded-full bg-slate-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                <span
                                    className={`inline-block h-6 w-6 transform rounded-full bg-accent transition-transform ${
                                        isMonthly ? 'translate-x-1' : 'translate-x-7'
                                    }`}
                                />
                            </button>
                            <span className={`text-sm font-medium ${!isMonthly ? 'text-white' : 'text-gray-500'}`}>
                                Anual{' '}
                                <span className="ml-1 text-xs text-accent">−33%</span>
                            </span>
                        </div>
                    </div>

                    <div className="mx-auto grid max-w-6xl gap-5 md:grid-cols-2 xl:grid-cols-4">
                        {/* Basic */}
                        <div className="flex flex-col rounded-2xl border border-white/10 bg-primary/40 p-7">
                            <h3 className="text-lg font-bold text-white">Basic</h3>
                            <div className="mt-3 text-3xl font-bold text-white">Grátis</div>
                            <ul className="mt-6 flex-1 space-y-3 text-sm text-gray-400">
                                <li className="flex gap-2">
                                    <CheckIcon /> 1 importação mensal
                                </li>
                                <li className="flex gap-2">
                                    <CheckIcon /> Dashboard resumido
                                </li>
                                <li className="flex gap-2">
                                    <CheckIcon /> Acesso individual
                                </li>
                            </ul>
                            <Link
                                to={signupHref}
                                className="mt-8 block w-full rounded-lg border border-white/15 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/5"
                            >
                                Criar conta
                            </Link>
                        </div>

                        {/* PRO — recomendado */}
                        <div className="relative flex flex-col rounded-2xl border border-accent/40 bg-primary/60 p-7 shadow-[0_0_0_1px_rgba(56,178,172,0.15)]">
                            <span className="absolute -top-3 left-7 rounded bg-accent px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                                Recomendado
                            </span>
                            <h3 className="text-lg font-bold text-white">
                                PRO {isMonthly ? 'Mensal' : 'Anual'}
                            </h3>
                            <div className="mt-3 text-3xl font-bold text-white">
                                <span className="text-lg font-semibold text-gray-400">R$</span>{' '}
                                {isMonthly ? '14,90' : '9,99'}
                                <span className="text-base font-normal text-gray-500">/mês</span>
                            </div>
                            <p className="mt-1 text-sm text-gray-500">
                                {isMonthly ? 'Cobrado R$ 14,90 por mês' : 'Cobrado R$ 119,90 por ano'}
                            </p>
                            <ul className="mt-6 flex-1 space-y-3 text-sm text-gray-300">
                                <li className="flex gap-2">
                                    <CheckIcon color="text-accent" /> Importações ilimitadas
                                </li>
                                <li className="flex gap-2">
                                    <CheckIcon color="text-accent" /> Plano Família opcional (+R$4,90/conta)
                                </li>
                                <li className="flex gap-2">
                                    <CheckIcon color="text-accent" /> Dashboard completo & IA
                                </li>
                            </ul>
                            <Link
                                to={signupHref}
                                className="mt-8 block w-full rounded-lg bg-accent py-3 text-center text-sm font-bold text-white transition hover:bg-accent/90"
                            >
                                Assinar PRO
                            </Link>
                        </div>

                        {/* Wealth */}
                        <div className="flex flex-col rounded-2xl border border-white/10 bg-primary/40 p-7">
                            <h3 className="text-lg font-bold text-white">
                                Wealth {isMonthly ? 'Mensal' : 'Anual'}
                            </h3>
                            <div className="mt-3 text-3xl font-bold text-white">
                                <span className="text-lg font-semibold text-gray-400">R$</span>{' '}
                                {isMonthly ? '29,90' : '19,90'}
                                <span className="text-base font-normal text-gray-500">/mês</span>
                            </div>
                            <p className="mt-1 text-sm text-gray-500">
                                {isMonthly ? 'Cobrado R$ 29,90 por mês' : 'Cobrado R$ 238,80 por ano'}
                            </p>
                            <ul className="mt-6 flex-1 space-y-3 text-sm text-gray-400">
                                <li className="flex gap-2">
                                    <CheckIcon /> Tudo do PRO
                                </li>
                                <li className="flex gap-2">
                                    <CheckIcon /> Investimentos e cotações
                                </li>
                                <li className="flex gap-2">
                                    <CheckIcon /> 1 vaga Família inclusa
                                </li>
                            </ul>
                            <Link
                                to={signupHref}
                                className="mt-8 block w-full rounded-lg border border-white/15 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/5"
                            >
                                Assinar Wealth
                            </Link>
                        </div>

                        {/* Founder */}
                        <div className="flex flex-col rounded-2xl border border-white/15 bg-gradient-to-b from-secondary/80 to-primary/80 p-7">
                            <h3 className="text-lg font-bold text-white">Founder&apos;s Pack</h3>
                            <div className="mt-3 text-3xl font-bold text-white">
                                <span className="text-lg font-semibold text-gray-400">R$</span> 149,00
                            </div>
                            <p className="mt-1 text-sm text-gray-500">Pagamento único · vitalício</p>
                            <ul className="mt-6 flex-1 space-y-3 text-sm text-gray-300">
                                <li className="flex gap-2">
                                    <CheckIcon color="text-accent" /> Acesso vitalício ao app
                                </li>
                                <li className="flex gap-2">
                                    <CheckIcon color="text-accent" /> Todos os recursos Wealth
                                </li>
                                <li className="flex gap-2">
                                    <CheckIcon color="text-accent" /> 1 vaga Família inclusa
                                </li>
                                <li className="flex gap-2">
                                    <CheckIcon color="text-accent" /> Selo Founder
                                </li>
                            </ul>
                            <p
                                className={`mt-4 text-center text-xs font-semibold tracking-wide ${
                                    isSoldOut ? 'text-red-400' : 'text-gray-400'
                                }`}
                            >
                                {isSoldOut
                                    ? 'Esgotado'
                                    : `${remainingSpots} ${remainingSpots === 1 ? 'vaga restante' : 'vagas restantes'}`}
                            </p>
                            <Link
                                to={isSoldOut ? '#' : signupHref}
                                onClick={(e) => isSoldOut && e.preventDefault()}
                                aria-disabled={isSoldOut}
                                className={`mt-3 block w-full rounded-lg py-3 text-center text-sm font-bold transition ${
                                    isSoldOut
                                        ? 'cursor-not-allowed bg-slate-800 text-gray-500'
                                        : 'bg-white text-primary hover:bg-gray-100'
                                }`}
                            >
                                {isSoldOut ? 'Oferta encerrada' : 'Garantir acesso vitalício'}
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            <footer className="border-t border-white/[0.06] py-12 text-center text-sm text-gray-500">
                <div className="mb-8 flex justify-center gap-6">
                    <a
                        href="https://www.instagram.com/finelo_oficial/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 transition-colors hover:text-accent"
                        aria-label="Instagram"
                    >
                        <InstagramIcon className="h-6 w-6" />
                    </a>
                    <a
                        href="https://www.youtube.com/@FinElo_Oficial"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 transition-colors hover:text-accent"
                        aria-label="YouTube"
                    >
                        <YoutubeIcon className="h-6 w-6" />
                    </a>
                    <a
                        href="https://www.facebook.com/profile.php?id=61586610943211"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 transition-colors hover:text-accent"
                        aria-label="Facebook"
                    >
                        <FacebookIcon className="h-6 w-6" />
                    </a>
                    <a
                        href="https://wa.me/5511981967070"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 transition-colors hover:text-accent"
                        aria-label="WhatsApp"
                    >
                        <WhatsappIcon className="h-6 w-6" />
                    </a>
                </div>
                <p>© 2026 FinElo. Todos os direitos reservados.</p>
                <div className="mt-4 flex justify-center gap-6">
                    <button
                        type="button"
                        onClick={() => setShowTerms(true)}
                        className="cursor-pointer border-none bg-transparent transition-colors hover:text-white"
                    >
                        Termos de Uso
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowTerms(true)}
                        className="cursor-pointer border-none bg-transparent transition-colors hover:text-white"
                    >
                        Privacidade
                    </button>
                    <a href="mailto:suporte@finelo.app.br" className="transition-colors hover:text-white">
                        Fale com o Suporte
                    </a>
                </div>
            </footer>

            <a
                href="https://wa.me/5511981967070"
                target="_blank"
                rel="noopener noreferrer"
                className="group fixed bottom-6 right-6 z-50 flex items-center justify-center rounded-full border border-white/20 bg-[#25D366] p-4 text-white shadow-lg transition hover:bg-[#20b858] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                aria-label="Fale conosco no WhatsApp"
            >
                <WhatsappIcon className="h-8 w-8" />
                <span className="pointer-events-none absolute right-full mr-4 whitespace-nowrap rounded-lg border border-slate-100 bg-white px-4 py-2 text-sm font-bold text-slate-800 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                    Dúvidas? Fale conosco
                </span>
            </a>

            <TermsModal isOpen={showTerms} onClose={() => setShowTerms(false)} />
        </div>
    );
};

const EditorialStep = ({
    step,
    title,
    description,
    imageSrc,
    imageAlt,
    reverse = false,
    reduceMotion,
}: {
    step: string;
    title: string;
    description: string;
    imageSrc: string;
    imageAlt: string;
    reverse?: boolean;
    reduceMotion: boolean | null;
}) => (
    <motion.li
        initial={reduceMotion ? false : { opacity: 0, y: 20 }}
        whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.5 }}
        className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
    >
        <div className={reverse ? 'lg:order-2' : undefined}>
            <span className="font-mono text-sm font-medium text-accent/80">{step}</span>
            <h3 className="mt-2 text-2xl font-bold text-white md:text-3xl">{title}</h3>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-gray-400">{description}</p>
        </div>
        <div
            className={`overflow-hidden rounded-2xl border border-white/10 bg-secondary/30 shadow-lg shadow-black/20 ${
                reverse ? 'lg:order-1' : ''
            }`}
        >
            <img src={imageSrc} alt={imageAlt} className="w-full object-cover object-top" loading="lazy" />
        </div>
    </motion.li>
);

const VisaIcon = ({ className = '' }) => (
    <svg className={className} viewBox="0 0 1000 325" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
            d="M651.185.5c-70.933 0-134.322 36.766-134.322 104.694 0 77.9 112.423 83.28 112.423 122.415 0 16.478-18.884 31.229-51.137 31.229-45.773 0-79.984-20.611-79.984-20.611l-14.638 68.547s39.41 17.41 91.734 17.41c77.552 0 138.576-38.572 138.576-107.66 0-82.316-112.89-87.537-112.89-123.86 0-12.91 15.501-27.053 47.662-27.053 36.286 0 65.892 14.99 65.892 14.99l14.326-66.204S696.614.5 651.185.5zM2.218 5.497L.5 15.49s29.842 5.461 56.719 16.356c34.606 12.492 37.072 19.765 42.9 42.353l63.51 244.832h85.138L379.927 5.497h-84.942L210.707 218.67l-34.39-180.696c-3.154-20.68-19.13-32.477-38.685-32.477H2.218zm411.865 0L347.449 319.03h80.999l66.4-313.534h-80.765zm451.759 0c-19.532 0-29.88 10.457-37.474 28.73L709.699 319.03h84.942l16.434-47.468h103.483l9.994 47.468H999.5L934.115 5.497h-68.273zm11.047 84.707l25.178 117.653h-67.454z"
            fill="#1434cb"
        />
    </svg>
);

const ApplePayIcon = ({ className = '' }) => (
    <svg className={className} viewBox="-2.48 135.79 499.389 229.888" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
            d="m131.82 230.99c.3 27.1 24.6 36.1 24.8 36.2-.2.6-3.9 12.9-12.8 25.5-7.7 10.9-15.7 21.8-28.3 22-12.4.2-16.4-7.1-30.5-7.1-14.2 0-18.6 6.9-30.3 7.3-12.2.4-21.4-11.8-29.2-22.7-15.9-22.2-28-62.8-11.7-90.2 8.1-13.6 22.6-22.2 38.3-22.5 11.9-.2 23.2 7.8 30.5 7.8s21-9.6 35.4-8.2c6 .2 23 2.4 33.8 17.8-.9.5-20.2 11.4-20 34.1m-23.3-66.6c6.5-7.6 10.8-18.1 9.6-28.6-9.3.4-20.6 6-27.2 13.6-6 6.7-11.2 17.4-9.8 27.7 10.4.8 21-5.1 27.4-12.7m93.551-12.985c4.756-.79 10.118-1.483 15.886-2.175s12.141-.593 19.021-.593c9.916 0 18.415 1.186 25.599 3.46 7.184 2.371 13.052 5.633 17.706 10.08 3.946 3.855 7.083 8.5 9.309 13.738 2.226 5.337 3.339 11.465 3.339 18.383 0 8.401-1.518 15.715-4.553 22.04s-7.184 11.564-12.445 15.814-11.535 7.413-18.82 9.587c-7.285 2.075-15.177 3.163-23.777 3.163-7.79 0-14.266-.593-19.528-1.68v69.579h-11.635v-161.001zm11.636 81.241c2.833.791 5.97 1.384 9.41 1.68s7.183.495 11.13.495c14.873 0 26.306-3.36 34.502-10.18 8.195-6.72 12.242-16.703 12.242-29.75 0-6.325-1.112-11.76-3.237-16.406s-5.16-8.5-9.106-11.464-8.702-5.239-14.064-6.721c-5.464-1.483-11.434-2.273-18.112-2.273-5.26 0-9.814.197-13.659.593s-6.88.89-9.106 1.285zm171.702 52.184c0 4.646.101 9.39.202 14.035.203 4.646.708 9.192 1.518 13.54h-10.927l-1.72-16.405h-.506c-1.518 2.273-3.34 4.547-5.667 6.72a41.22 41.22 0 0 1 -7.993 6.129c-3.035 1.877-6.475 3.36-10.421 4.447-3.845 1.087-8.095 1.68-12.749 1.68-5.767 0-10.826-.89-15.177-2.767s-7.993-4.25-10.725-7.215c-2.833-2.965-4.958-6.424-6.273-10.279-1.416-3.854-2.125-7.709-2.125-11.563 0-13.738 5.869-24.215 17.707-31.627s29.544-10.97 53.321-10.674v-3.163c0-3.064-.303-6.523-.91-10.476s-1.821-7.71-3.845-11.267-4.958-6.524-8.904-8.896-9.308-3.656-16.087-3.656c-5.16 0-10.22.79-15.177 2.273a49.895 49.895 0 0 0 -13.76 6.424l-3.744-8.5c5.26-3.558 10.725-6.029 16.29-7.61 5.564-1.483 11.433-2.273 17.605-2.273 8.296 0 14.974 1.384 20.134 4.15s9.309 6.326 12.243 10.675 4.958 9.192 6.071 14.627 1.619 10.773 1.619 16.11zm-11.636-34.492c-6.273-.198-12.85.099-19.629.692-6.88.691-13.153 2.075-18.92 4.25s-10.523 5.337-14.368 9.586c-3.743 4.151-5.666 9.785-5.666 16.703 0 8.204 2.429 14.232 7.184 18.087s10.118 5.831 16.088 5.831c4.755 0 9.106-.692 12.85-1.976s7.082-3.064 9.915-5.239 5.16-4.645 7.082-7.412 3.34-5.535 4.351-8.5c.81-3.261 1.214-5.535 1.214-7.017zm34.3-53.964 30.152 75.41c1.618 4.152 3.237 8.5 4.755 12.948s2.833 8.5 3.946 12.255h.506c1.113-3.558 2.428-7.51 3.946-11.958s3.137-8.994 4.958-13.64l28.229-74.916h12.344l-34.401 85.096c-3.44 8.994-6.78 17.198-9.815 24.511s-6.172 13.936-9.308 19.866-6.273 11.07-9.511 15.616-6.78 8.5-10.725 11.86c-4.654 4.052-8.904 7.017-12.749 8.796-3.845 1.878-6.475 3.064-7.79 3.46l-3.947-9.39c2.935-1.285 6.274-2.965 9.916-5.04s7.184-4.843 10.624-8.204c2.934-2.866 6.273-6.72 9.814-11.465s6.678-10.476 9.511-17.296c1.012-2.57 1.518-4.25 1.518-5.04 0-1.087-.506-2.866-1.518-5.04l-42.798-107.533h12.344z"
            fill="white"
        />
    </svg>
);

const GooglePayIcon = ({ className = '' }) => (
    <svg className={className} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        <path
            d="M242,253.46v59.5h-19.19V165.81h49.91c12.15,0,23.66,4.47,32.63,12.79c8.96,7.67,13.44,19.19,13.44,31.35s-4.47,23.03-13.44,31.35c-8.96,8.32-19.83,12.79-32.63,12.79L242,253.46z M242,183.72v51.19h32c7.04,0,14.08-2.57,18.56-7.67c10.24-9.59,10.24-25.59,0.63-35.19l-0.63-0.65c-5.12-5.12-11.52-8.32-18.56-7.67H242z"
            fill="white"
        />
        <path
            d="M362.93,209.32c14.08,0,24.95,3.83,33.27,11.52c8.32,7.67,12.15,17.91,12.15,30.71v61.43h-17.91v-14.08h-0.63c-7.67,11.52-18.56,17.28-31.35,17.28c-10.87,0-20.48-3.2-28.15-9.59c-7.04-6.4-11.52-15.36-11.52-24.95c0-10.24,3.84-18.54,11.52-24.95c7.67-6.4,18.54-8.96,31.35-8.96c11.52,0,20.48,1.92,27.51,6.4v-4.47c0-6.4-2.55-12.79-7.67-16.64c-5.12-4.47-11.52-7.04-18.56-7.04c-10.87,0-19.19,4.47-24.95,13.44l-16.64-10.24C331.58,215.71,345.02,209.32,362.93,209.32z M338.62,282.25c0,5.12,2.55,9.59,6.4,12.15c4.47,3.2,9.59,5.12,14.71,5.12c7.67,0,15.36-3.2,21.11-8.95c6.4-5.77,9.59-12.79,9.59-20.48c-5.75-4.47-14.08-7.04-24.95-7.04c-7.67,0-14.08,1.92-19.19,5.75C341.17,272.01,338.62,276.49,338.62,282.25z"
            fill="white"
        />
        <polygon
            points="512,212.52 448.67,357.74 429.46,357.74 453.14,307.2 411.55,213.15 432.03,213.15 462.09,285.44 462.73,285.44 492.16,213.15 512,213.15"
            fill="white"
        />
        <path
            d="M165.88,240.67c0-5.77-0.65-11.52-1.28-17.28H84.63v32.63h45.42c-1.92,10.24-7.67,19.83-16.64,25.59v21.11h27.51C156.91,288.01,165.88,266.25,165.88,240.67z"
            fill="#4285F4"
        />
        <path
            d="M84.61,323.19c23.03,0,42.22-7.67,56.31-20.48l-27.51-21.11c-7.67,5.12-17.28,8.32-28.78,8.32c-21.76,0-40.95-14.71-47.34-35.19H9.12v21.76C23.83,305.28,52.63,323.19,84.61,323.19z"
            fill="#34A853"
        />
        <path
            d="M37.27,254.74c-3.84-10.24-3.84-21.76,0-32.63v-21.76H9.12c-12.16,23.68-12.16,51.83,0,76.14L37.27,254.74z"
            fill="#FBBC04"
        />
        <path
            d="M84.61,187.56c12.16,0,23.68,4.47,32.63,12.79l24.32-24.31c-15.36-14.07-35.83-22.39-56.31-21.76c-32,0-61.41,17.91-75.49,46.71l28.15,21.74C43.67,202.28,62.86,187.56,84.61,187.56z"
            fill="#EA4335"
        />
    </svg>
);

const MastercardIcon = ({ className = '' }) => (
    <svg className={className} viewBox="0 0 40 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="16" r="12" fill="#EB001B" />
        <circle cx="28" cy="16" r="12" fill="#F79E1B" fillOpacity="1" />
        <path
            d="M20 16a11.977 11.977 0 014.125-9.155A11.977 11.977 0 0120 25.155a11.977 11.977 0 01-4.125-9.155c0-3.564 1.55-6.764 4.125-9.155z"
            fill="#FF5F00"
        />
    </svg>
);

const BoletoIcon = ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="24" height="24" rx="4" fill="#334155" fillOpacity="0.2" />
        <path
            d="M4 7V17H5V7H4ZM6 7V17H8V7H6ZM9 7V17H10V7H9ZM11 7V17H12V7H11ZM13 7V17H15V7H13ZM16 7V17H17V7H16ZM18 7V17H20V7H18Z"
            fill="white"
        />
        <path d="M4 18H20V20H4V18Z" fill="white" opacity="0.5" />
    </svg>
);

const CheckIcon = ({ color = 'text-gray-500' }) => (
    <svg className={`h-5 w-5 ${color} flex-shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
);

export default LandingPage;
