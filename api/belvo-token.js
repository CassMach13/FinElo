// api/belvo-token.js
// Gera o token de acesso para o Belvo Widget
// Equivalente ao antigo pluggy-token.js

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const secretId = process.env.BELVO_SECRET_ID;
    const secretPassword = process.env.BELVO_SECRET_PASSWORD;
    const belvoEnv = process.env.BELVO_ENV || 'sandbox'; // 'sandbox' ou 'production'

    if (!secretId || !secretPassword) {
        return res.status(500).json({
            error: 'Credenciais Belvo não configuradas.',
            hint: 'Adicione BELVO_SECRET_ID e BELVO_SECRET_PASSWORD nas variáveis de ambiente do Vercel.'
        });
    }

    const baseUrl = belvoEnv === 'production'
        ? 'https://api.belvo.com'
        : 'https://sandbox.belvo.com';

    try {
        // Belvo usa Basic Auth: secretId:secretPassword em Base64
        const credentials = Buffer.from(`${secretId}:${secretPassword}`).toString('base64');

        const response = await fetch(`${baseUrl}/api/token/`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: secretId,
                password: secretPassword,
                scopes: 'read_institutions,write_links,read_accounts,read_transactions,read_owners'
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[Belvo Token] Erro da API:', data);
            return res.status(response.status).json({
                error: 'Erro ao gerar token Belvo',
                details: data
            });
        }

        // Retorna o access token para o widget no frontend
        return res.status(200).json({ accessToken: data.access });

    } catch (error) {
        console.error('[Belvo Token] Exceção:', error.message);
        return res.status(500).json({
            error: 'Falha ao conectar com a API Belvo',
            message: error.message
        });
    }
}
