// api/belvo-consent.js
// Gera um Token de Acesso para o Widget seguindo o fluxo oficial OFDA Brasil.
// Documentação: "Extrair Dados Bancários no Brasil (Widget)"

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { institution, userDocument, userName, externalId } = req.body;

    if (!userDocument) {
        return res.status(400).json({ error: 'userDocument é obrigatório.' });
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
        const cleanDocument = String(userDocument).replace(/\D/g, '');
        const cleanName = String(userName || 'Usuário FinElo').trim();

        // 1. Gera o token de acesso especializado para OFDA
        const credentials = Buffer.from(`${secretId}:${secretPassword}`).toString('base64');
        
        const tokenPayload = {
            id: secretId,
            password: secretPassword,
            // Scopes obrigatórios para OFDA Brasil
            scopes: 'read_institutions,write_links,read_consents,write_consents,write_consent_callback,delete_consents',
            stale_in: '300d',
            fetch_resources: ['ACCOUNTS', 'TRANSACTIONS', 'OWNERS', 'BILLS'],
            widget: {
                purpose: 'Consolidação de contas e análise de gastos para gestão financeira pessoal na FinElo.',
                openfinance_feature: 'consent_link_creation',
                callback_urls: {
                    success: 'https://www.finelo.app.br/import?status=success',
                    exit: 'https://www.finelo.app.br/import?status=exit',
                    event: 'https://www.finelo.app.br/import?status=error'
                },
                consent: {
                    terms_and_conditions_url: 'https://www.finelo.app.br/terms',
                    // Permissões EXATAS do guia OFDA
                    permissions: ['REGISTER', 'ACCOUNTS', 'CREDIT_CARDS', 'CREDIT_OPERATIONS'],
                    identification_info: [
                        {
                            type: 'CPF',
                            number: cleanDocument,
                            name: cleanName
                        }
                    ]
                },
                branding: {
                    company_icon: 'https://www.finelo.app.br/icon.svg',
                    company_logo: 'https://www.finelo.app.br/logo.png',
                    company_name: 'FinElo',
                    company_terms_url: 'https://www.finelo.app.br/terms',
                    social_proof: true
                }
            }
        };

        const tokenRes = await fetch(`${baseUrl}/api/token/`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(tokenPayload),
        });

        const tokenData = await tokenRes.json();
        
        if (!tokenRes.ok) {
            console.error('[Belvo Token Error]', tokenData);
            return res.status(tokenRes.status).json({ 
                error: 'Falha ao gerar token de acesso OFDA', 
                details: tokenData 
            });
        }

        // Retorna o token de acesso (que já contém o consentimento configurado)
        return res.status(200).json({
            accessToken: tokenData.access,
            belvoEnv: belvoEnv,
            externalId: externalId
        });

    } catch (error) {
        console.error('[Belvo Exception]', error.message);
        return res.status(500).json({
            error: 'Erro interno ao processar token Belvo',
            message: error.message
        });
    }
}
