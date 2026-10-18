
import { PluggyClient } from 'pluggy-sdk';

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    try {
        const payload = req.body || {};
        const itemId = payload.itemId;
        if (!itemId) throw new Error('Missing itemId');

        const clientId = process.env.PLUGGY_CLIENT_ID || process.env.VITE_PLUGGY_CLIENT_ID;
        const clientSecret = process.env.PLUGGY_CLIENT_SECRET || process.env.VITE_PLUGGY_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            return res.status(500).json({
                error: 'Missing Pluggy Credentials in Environment Variables.',
                details: 'PLUGGY_CLIENT_ID and PLUGGY_CLIENT_SECRET must be set in Vercel.',
                foundClientId: !!clientId,
                foundClientSecret: !!clientSecret
            });
        }

        const client = new PluggyClient({
            clientId,
            clientSecret,
        });

        // 1. Fetch Accounts
        const accData = await client.fetchAccounts(itemId);
        if (!accData.results) throw new Error('Failed to fetch accounts from Pluggy');

        let allTransactions = [];

        // 2. Fetch Transactions for each account
        for (const account of accData.results) {
            const defaultFrom = new Date();
            defaultFrom.setDate(defaultFrom.getDate() - 30);
            const startDateStr = payload.fromDate || defaultFrom.toISOString().split('T')[0];
            const endDateStr = payload.toDate || new Date().toISOString().split('T')[0];

            const txData = await client.fetchTransactions(account.id, {
                from: startDateStr,
                to: endDateStr
            });

            if (txData.results) {
                allTransactions = [...allTransactions, ...txData.results.map((tx) => ({ ...tx, _bankAccount: account }))];
            }
        }

        res.status(200).json({
            accounts: accData.results,
            transactions: allTransactions
        });
    } catch (error) {
        console.error('Pluggy Sync Error:', error);
        res.status(500).json({
            error: 'Failed to sync Pluggy data',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
