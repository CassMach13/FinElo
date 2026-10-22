// api/belvo-sync.js
// Busca contas e transações de um link Belvo
// Equivalente ao antigo pluggy-sync.js

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { linkId, fromDate, toDate } = req.body || {};
    if (!linkId) return res.status(400).json({ error: 'linkId é obrigatório.' });

    const secretId = process.env.BELVO_SECRET_ID;
    const secretPassword = process.env.BELVO_SECRET_PASSWORD;
    const belvoEnv = process.env.BELVO_ENV || 'sandbox';

    if (!secretId || !secretPassword) {
        return res.status(500).json({ error: 'Credenciais Belvo não configuradas.' });
    }

    const baseUrl = belvoEnv === 'production'
        ? 'https://api.belvo.com'
        : 'https://sandbox.belvo.com';

    const credentials = Buffer.from(`${secretId}:${secretPassword}`).toString('base64');
    const headers = {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
    };

    // Período padrão: últimos 30 dias
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    const dateFrom = fromDate || defaultFrom.toISOString().split('T')[0];
    const dateTo = toDate || new Date().toISOString().split('T')[0];

    try {
        // BYPASS DE DESENVOLVEDOR: Se o linkId for de teste, retorna dados fictícios
        if (linkId.startsWith('mock-belvo-')) {
            const mockAccounts = [{
                id: 'acc-mock-123',
                name: 'Conta Corrente Simulação',
                type: 'CHECKING_ACCOUNT',
                currency: 'BRL',
                balance: { current: 5420.50, available: 5420.50 },
                institution: { name: 'Banco Simulado' }
            }];

            const mockTransactions = [
                {
                    id: 'tx-mock-001',
                    type: 'DEBIT',
                    amount: 150.00,
                    date: new Date().toISOString(),
                    description: 'Netflix Entretenimento',
                    category: 'Lazer',
                    account_id: 'acc-mock-123'
                },
                {
                    id: 'tx-mock-002',
                    type: 'CREDIT',
                    amount: 2500.00,
                    date: new Date().toISOString(),
                    description: 'Depósito Recebido',
                    category: 'Renda',
                    account_id: 'acc-mock-123'
                },
                {
                    id: 'tx-mock-003',
                    type: 'DEBIT',
                    amount: 85.50,
                    date: new Date().toISOString(),
                    description: 'Posto de Gasolina',
                    category: 'Transporte',
                    account_id: 'acc-mock-123'
                }
            ];

            return res.status(200).json({ accounts: mockAccounts, transactions: mockTransactions });
        }
        // 1. Buscar contas do link
        const accountsRes = await fetch(`${baseUrl}/api/accounts/?link=${linkId}`, { headers });
        const accountsData = await accountsRes.json();

        if (!accountsRes.ok) {
            console.error('[Belvo Sync] Erro ao buscar contas:', accountsData);
            return res.status(accountsRes.status).json({ error: 'Erro ao buscar contas Belvo', details: accountsData });
        }

        const accounts = accountsData.results || accountsData || [];

        // 2. Buscar transações do link via POST (Belvo armazena e retorna em uma única chamada)
        const txRes = await fetch(`${baseUrl}/api/transactions/`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                link: linkId,
                date_from: dateFrom,
                date_to: dateTo,
                // Belvo armazena as transações e as retorna — não há opção "sem salvar"
            }),
        });

        const txData = await txRes.json();

        if (!txRes.ok) {
            console.error('[Belvo Sync] Erro ao buscar transações:', JSON.stringify(txData));

            // Se o link não existe no Belvo (400/404), é uma conexão antiga do Pluggy
            if (txRes.status === 400 || txRes.status === 404) {
                return res.status(400).json({
                    error: 'conexao_pluggy_legada',
                    message: 'Esta conexão foi feita com o sistema antigo. Reconecte este banco clicando em "+ Conectar Novo Banco".',
                    details: txData,
                });
            }

            return res.status(txRes.status).json({ error: 'Erro ao buscar transações Belvo', details: txData });
        }

        const rawTransactions = Array.isArray(txData) ? txData : (txData.results || []);

        // 3. Normalizar transações para o formato que o openFinanceService.ts espera
        // Belvo usa OUTFLOW/INFLOW, FinElo usa DEBIT/CREDIT (mesma lógica da Pluggy)
        const transactions = rawTransactions.map(tx => ({
            id: tx.id,                              // ID único Belvo
            type: tx.type === 'OUTFLOW' ? 'DEBIT' : 'CREDIT', // normaliza para padrão Pluggy
            amount: Math.abs(tx.amount),            // Belvo: sempre positivo
            date: tx.value_date || tx.accounting_date, // data de valor
            description: tx.description || tx.reference || 'Sem descrição',
            creditDebitType: tx.type === 'OUTFLOW' ? 'DEBITO' : 'CREDITO', // Open Finance BR
            currency: tx.currency,
            account_id: tx.account?.id,
            status: tx.status,
            category: tx.category,                 // Belvo já categoriza!
            _raw: tx,                              // dados originais para debug
        }));

        console.log(`[Belvo Sync] ✅ Link ${linkId}: ${accounts.length} contas, ${transactions.length} transações`);

        return res.status(200).json({ accounts, transactions });

    } catch (error) {
        console.error('[Belvo Sync] Exceção:', error.message);
        return res.status(500).json({
            error: 'Falha ao sincronizar com Belvo',
            message: error.message
        });
    }
}
