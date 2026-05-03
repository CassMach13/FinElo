import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Este endpoint recebe eventos do Stripe e atualiza a tabela public.subscriptions
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!stripeSecret || !webhookSecret || !supabaseUrl || !supabaseServiceKey) {
        console.error('Variáveis de ambiente faltando:', {
            stripeSecret: !!stripeSecret,
            webhookSecret: !!webhookSecret,
            supabaseUrl: !!supabaseUrl,
            supabaseServiceKey: !!supabaseServiceKey,
        });
        return res.status(500).json({ error: 'Configuração do servidor incompleta.' });
    }

    // Supabase com Service Role (bypassa RLS para poder escrever em nome do usuário)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const stripe = new Stripe(stripeSecret);

    // Verificar assinatura do webhook para garantir que veio do Stripe
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        const rawBody = await getRawBody(req);
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    console.log(`[Stripe Webhook] Evento recebido: ${event.type}`);

    try {
        switch (event.type) {
            // Compra única ou assinatura completada via Payment Link
            case 'checkout.session.completed': {
                const session = event.data.object;
                await handleCheckoutCompleted(session, stripe, supabase);
                break;
            }
            // Assinatura criada (recorrente)
            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                await handleSubscriptionUpsert(subscription, stripe, supabase);
                break;
            }
            // Assinatura cancelada
            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                await handleSubscriptionDeleted(subscription, stripe, supabase);
                break;
            }
            default:
                console.log(`[Stripe Webhook] Evento ignorado: ${event.type}`);
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        console.error('[Stripe Webhook] Erro ao processar evento:', err);
        return res.status(500).json({ error: 'Erro interno ao processar evento.' });
    }
}

// --- HANDLERS ---

async function handleCheckoutCompleted(session, stripe, supabase) {
    const customerEmail = session.customer_details?.email || session.customer_email;
    if (!customerEmail) {
        console.warn('[Checkout] Sem email no session. Pulando.');
        return;
    }

    console.log(`[Checkout] Processando compra para: ${customerEmail}`);

    // Determinar o plano com base no modo do checkout
    let plan_type = 'monthly';
    let tier = 'pro';
    let status = 'active';
    let unlimited_sync = false;
    let family_slots = 0;
    let current_period_end = null;

    if (session.mode === 'payment') {
        // Compra única = Founder's Pack (vitalício) — acesso total igual Netflix Premium
        plan_type = 'lifetime';
        tier = 'wealth';
        status = 'lifetime';
        unlimited_sync = true;   // Open Finance ilimitado
        family_slots = 5;        // Slots de plano família
        current_period_end = null;
    } else if (session.mode === 'subscription' && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = sub.items.data[0]?.price?.id;
        const interval = sub.items.data[0]?.price?.recurring?.interval;

        plan_type = interval === 'year' ? 'annual' : 'monthly';
        tier = getPlanTierFromPriceId(priceId);
        status = sub.status;
        unlimited_sync = (tier === 'wealth'); // Wealth anual/mensal também tem sync ilimitado
        family_slots = (tier === 'wealth') ? 5 : 2;
        current_period_end = new Date(sub.current_period_end * 1000).toISOString();
    }

    console.log(`[Checkout] Plano: ${plan_type}/${tier}/${status} | sync_ilimitado: ${unlimited_sync}`);

    // Busca o usuário no Supabase pelo email
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) throw authError;

    const user = authUsers.users.find(u => u.email?.toLowerCase() === customerEmail.toLowerCase());

    if (!user) {
        // ⚠️ Usuário comprou mas ainda não criou conta na FinElo
        // Salvamos em tabela de ativações pendentes para processar quando ele se cadastrar
        console.warn(`[Checkout] Usuário não encontrado para: ${customerEmail} — salvando ativação pendente.`);
        await supabase.from('pending_activations').upsert({
            email: customerEmail.toLowerCase(),
            plan_type,
            tier,
            status,
            unlimited_sync,
            family_slots,
            stripe_customer_id: session.customer,
            stripe_session_id: session.id,
            created_at: new Date().toISOString(),
        }, { onConflict: 'email' });
        return;
    }

    // Upsert na tabela subscriptions com todos os benefícios
    const { error } = await supabase
        .from('subscriptions')
        .upsert({
            user_id: user.id,
            plan_type,
            tier,
            status,
            unlimited_sync,
            family_slots,
            current_period_end,
            stripe_customer_id: session.customer,
            stripe_session_id: session.id,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

    if (error) {
        console.error('[Checkout] Erro ao fazer upsert:', error);
        throw error;
    }

    console.log(`[Checkout] ✅ Founder's Pack ativado automaticamente para: ${customerEmail}`);
}

async function handleSubscriptionUpsert(subscription, stripe, supabase) {
    const customerId = subscription.customer;
    const customer = await stripe.customers.retrieve(customerId);
    const customerEmail = customer.email;

    if (!customerEmail) {
        console.warn('[Subscription] Sem email no customer. Pulando.');
        return;
    }

    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const user = authUsers?.users.find(u => u.email?.toLowerCase() === customerEmail.toLowerCase());
    if (!user) {
        console.warn(`[Subscription] Usuário não encontrado: ${customerEmail}`);
        return;
    }

    const priceId = subscription.items.data[0]?.price?.id;
    const interval = subscription.items.data[0]?.price?.recurring?.interval;
    const plan_type = interval === 'year' ? 'annual' : 'monthly';
    const tier = getPlanTierFromPriceId(priceId);
    const current_period_end = new Date(subscription.current_period_end * 1000).toISOString();

    const { error } = await supabase
        .from('subscriptions')
        .upsert({
            user_id: user.id,
            plan_type,
            tier,
            status: subscription.status,
            current_period_end,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

    if (error) {
        console.error('[Subscription] Erro ao fazer upsert:', error);
        throw error;
    }

    console.log(`[Subscription] ✅ Atualizado: ${customerEmail} → ${plan_type}/${tier}/${subscription.status}`);
}

async function handleSubscriptionDeleted(subscription, stripe, supabase) {
    const customerId = subscription.customer;
    const customer = await stripe.customers.retrieve(customerId);
    const customerEmail = customer.email;
    if (!customerEmail) return;

    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const user = authUsers?.users.find(u => u.email?.toLowerCase() === customerEmail.toLowerCase());
    if (!user) return;

    const { error } = await supabase
        .from('subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('user_id', user.id);

    if (error) throw error;
    console.log(`[Subscription] ❌ Cancelada: ${customerEmail}`);
}

// Mapeia Price ID do Stripe para o tier do sistema
function getPlanTierFromPriceId(priceId) {
    // ⚠️ IMPORTANTE: Substitua pelos Price IDs reais dos seus produtos no Stripe
    // Você encontra em: Stripe Dashboard → Products → Seu Produto → Preços
    const priceToTier = {
        // PRO Mensal
        'price_pro_monthly_id': 'pro',
        // PRO Anual
        'price_pro_annual_id': 'pro',
        // Wealth Mensal
        'price_wealth_monthly_id': 'wealth',
        // Wealth Anual
        'price_wealth_annual_id': 'wealth',
    };
    return priceToTier[priceId] || 'pro'; // fallback pro
}

// Lê o body raw para verificação da assinatura Stripe
async function getRawBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(Buffer.from(data)));
        req.on('error', reject);
    });
}
