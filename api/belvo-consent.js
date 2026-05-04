// api/belvo-consent.js
// Cria um consentimento diretamente na API Belvo, bypassando o formulário do Widget.
// Isso resolve o problema do Widget formatar o CPF errado e enviar REGISTER nas permissões.

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { institution, userDocument, userName } = req.body;

    if (!institution || !userDocument) {
        return res.status(400).json({ error: 'institution e userDocument são obrigatórios.' });
    }

    const secretId = process.env.BELVO_SECRET_ID;
    const secretPassword = process.env.BELVO_SECRET_PASSWORD;
    const belvoEnv = process.env.BELVO_ENV || 'sandbox';
    const baseUrl = belvoEnv === 'production'
        ? 'https://api.belvo.com'
        : 'https://sandbox.belvo.com';

    if (!secretId || !secretPassword) {
        return res.status(500).json({ error: 'Credenciais Belvo não configuradas.' });
    }

    try {
        // 1. Gera o token de acesso
        const credentials = Buffer.from(`${secretId}:${secretPassword}`).toString('base64');

        const tokenRes = await fetch(`${baseUrl}/api/token/`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: secretId,
                password: secretPassword,
                scopes: 'read_institutions,write_links,read_consents,write_consents',
                fetch_resources: ['ACCOUNTS', 'TRANSACTIONS'],
            }),
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) {
            return res.status(tokenRes.status).json({ error: 'Falha ao gerar token', details: tokenData });
        }

        const accessToken = tokenData.access;

        // 2. Cria o consentimento diretamente — CPF limpo (só dígitos), nome obrigatório
        const cleanDocument = String(userDocument).replace(/\D/g, '');
        const cleanName = String(userName || 'Usuário FinElo').trim() || 'Usuário FinElo';

        const consentPayload = {
            institution: institution,
            user_document: cleanDocument,
            user_document_type: 'CPF',
            user_name: cleanName,
            // Permissões válidas para Open Finance BR (sem REGISTER)
            permissions: ['ACCOUNTS', 'CREDIT_CARDS_ACCOUNTS'],
        };

        console.log('[Belvo Consent] Criando consentimento:', JSON.stringify(consentPayload));

        const consentRes = await fetch(`${baseUrl}/api/consents/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(consentPayload),
        });

        const consentData = await consentRes.json();

        if (!consentRes.ok) {
            console.error('[Belvo Consent] Erro ao criar consentimento:', consentData);
            return res.status(consentRes.status).json({
                error: 'Falha ao criar consentimento',
                details: consentData
            });
        }

        // Retorna o consentimento criado e o token para o Widget abrir na etapa seguinte
        return res.status(200).json({
            consentId: consentData.id,
            accessToken: accessToken,
            status: consentData.status,
        });

    } catch (error) {
        console.error('[Belvo Consent] Exceção:', error.message);
        return res.status(500).json({
            error: 'Falha ao conectar com a API Belvo',
            message: error.message
        });
    }
}
