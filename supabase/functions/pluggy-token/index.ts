import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { PluggyClient } from 'npm:pluggy-sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const clientId = Deno.env.get('PLUGGY_CLIENT_ID')
    const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      throw new Error('Pluggy credentials are not configured on the server.')
    }

    const { itemId, clientUserId } = await req.json().catch(() => ({}))

    const client = new PluggyClient({
      clientId,
      clientSecret,
    })

    // Create the connect token with optional parameters
    const connectTokenResponse = await client.createConnectToken(
      itemId,
      undefined, // parameters
      { clientUserId } // options
    )

    return new Response(
      JSON.stringify({ accessToken: connectTokenResponse.accessToken }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (err) {
    console.error('Error generating pluggy token:', err.message)
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
