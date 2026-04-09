import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Edge Function: check-retention
 * Disparada via Cron (agendamento externo ou pg_cron) para re-engajar usuários.
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY não configurada.')
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

    // 1. Buscar usuários inativos via a função SQL que criamos
    const { data: users, error: fetchError } = await supabase
      .rpc('get_inactive_users_for_retention')

    if (fetchError) throw fetchError

    const results = []

    // 2. Processar cada usuário
    for (const user of (users || [])) {
      console.log(`Enviando e-mail de retenção para: ${user.email}`)

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'FinElo <oi@finelo.app.br>',
          to: [user.email],
          subject: 'Sentimos sua falta na FinElo! 🧘‍♂️',
          html: `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #009B77;">Olá, ${user.full_name || 'Amigo(a)'}!</h2>
              <p>Notamos que você não registra movimentações na FinElo há mais de 15 dias.</p>
              <p>Manter o controle diário é o segredo para a paz financeira. Que tal dedicar 1 minuto hoje para atualizar seus gastos?</p>
              <div style="margin: 30px 0;">
                <a href="https://finelo.app.br" style="background-color: #009B77; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                  Acessar minha conta
                </a>
              </div>
              <p style="font-size: 12px; color: #777;">
                Se você já se organizou por outros meios, ignore este e-mail. Estamos aqui para ajudar!
              </p>
            </div>
          `,
        }),
      })

      if (res.ok) {
        // Registrar sucesso no banco para evitar reenvio precoce
        await supabase
          .from('retention_history')
          .insert({
            user_id: user.user_id,
            email: user.email,
            retention_type: '15_days_inactivity',
            metadata: { status: 'success' }
          })
        
        results.push({ email: user.email, status: 'sent' })
      } else {
        const errorText = await res.text()
        console.error(`Erro ao enviar para ${user.email}:`, errorText)
        results.push({ email: user.email, status: 'error', error: errorText })
      }
    }

    return new Response(
      JSON.stringify({ message: 'Processamento concluído', total: (users || []).length, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
