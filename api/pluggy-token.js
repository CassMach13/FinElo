
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

        const options = {};
        if (payload.options) {
            Object.assign(options, payload.options);
        }

        const connectTokenResponse = await client.createConnectToken(payload.itemId, options);
        const token = connectTokenResponse.accessToken || connectTokenResponse;

        res.status(200).json({ accessToken: token });
    } catch (error) {
        console.error('Pluggy Token Error:', error);
        res.status(500).json({
            error: 'Failed to generate Pluggy Connect Token',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
