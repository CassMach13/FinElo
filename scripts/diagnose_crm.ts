import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
);

async function diagnose() {
  console.log('\n===== DIAGNÓSTICO DE ASSINATURAS =====\n');

  // 1. Ver todas as assinaturas
  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('user_id, status, plan_type, tier, unlimited_sync');

  if (error) {
    console.error('ERRO ao buscar subscriptions:', error.message);
    return;
  }

  console.log(`Total de registros em public.subscriptions: ${subs?.length ?? 0}\n`);
  if (subs && subs.length > 0) {
    console.table(subs);
  } else {
    console.log('⚠️  A tabela public.subscriptions está VAZIA.');
    console.log('   Isso explica por que todos os contadores estão zerados.');
    console.log('   O Webhook do Stripe não está populando essa tabela.\n');
  }

  // 2. Testar o RPC atual
  console.log('\n===== RESULTADO DO RPC get_admin_metrics =====\n');
  const { data: metrics, error: rpcErr } = await supabase.rpc('get_admin_metrics');
  if (rpcErr) {
    console.error('ERRO no RPC:', rpcErr.message);
    console.error('Código:', rpcErr.code);
  } else {
    const { crm_users, ...kpis } = metrics as any;
    console.log('KPIs retornados:', JSON.stringify(kpis, null, 2));
    console.log(`\nTotal de usuários no CRM: ${crm_users?.length ?? 0}`);
    if (crm_users?.length > 0) {
      console.log('\nPrimeiros 5 usuários:');
      console.table(crm_users.slice(0, 5).map((u: any) => ({
        email: u.email,
        plan_type: u.plan_type,
        tier: u.tier,
        plan_status: u.plan_status
      })));
    }
  }
}

diagnose();
