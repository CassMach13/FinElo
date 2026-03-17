import path from 'path';
import { defineConfig, loadEnv, ConfigEnv } from 'vite';
import react from '@vitejs/plugin-react';

import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }: ConfigEnv) => {
  const env = loadEnv(mode, process.cwd(), '');
  const projectRootDir = path.resolve(__dirname);
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(projectRootDir, 'src'),
      }
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: 'FinElo - Controle Financeiro v1.0.1',
          short_name: 'FinElo',
          description: 'O controle financeiro que conecta você à sua liberdade.',
          theme_color: '#1a202c',
          background_color: '#1a202c',
          display: 'standalone',
          display_override: ['window-controls-overlay', 'minimal-ui'],
          orientation: 'any',
          scope: '/',
          start_url: '/',
          icons: [
            { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,webmanifest}'],
          globIgnores: ['**/node_modules/**/*', 'demo-video.mp4'],
          skipWaiting: true,
          clientsClaim: true,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // <== 365 days
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // <== 365 days
                },
                cacheableResponse: {
                  statuses: [0, 200]
                },
              }
            },
            {
              // Supabase requests should be network first but fallback to cache
              urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-api-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 // <== 1 day
                },
                networkTimeoutSeconds: 5,
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            }
          ]
        }
      }),
      {
        name: 'pluggy-local-dev-proxy',
        configureServer(server) {
          server.middlewares.use('/api/pluggy-token', async (req, res) => {
            if (req.method === 'OPTIONS') {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
              res.statusCode = 200;
              res.end();
              return;
            }
            if (req.method === 'POST') {
              let body = '';
              req.on('data', chunk => { body += chunk.toString(); });
              req.on('end', async () => {
                try {
                  const payload = body ? JSON.parse(body) : {};
                  const clientId = env.VITE_PLUGGY_CLIENT_ID;
                  const clientSecret = env.VITE_PLUGGY_CLIENT_SECRET;
                  if (!clientId || !clientSecret) {
                    throw new Error('Missing VITE_PLUGGY_CLIENT_ID or VITE_PLUGGY_CLIENT_SECRET');
                  }
                  
                  // 1. Get API Key
                  const authRes = await fetch('https://api.pluggy.ai/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId, clientSecret })
                  });
                  const authData = await authRes.json();
                  if (!authData.apiKey) throw new Error('Failed to get Pluggy API Key');
                  
                  // 2. Get Connect Token
                  const tokenReqBody: any = {};
                  if (payload.clientUserId) tokenReqBody.clientUserId = payload.clientUserId;
                  if (payload.itemId) tokenReqBody.itemId = payload.itemId;
                  
                  const tokenRes = await fetch('https://api.pluggy.ai/connect_token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-API-KEY': authData.apiKey },
                    body: JSON.stringify(tokenReqBody)
                  });
                  const tokenData = await tokenRes.json();
                  
                  res.setHeader('Content-Type', 'application/json');
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  res.statusCode = 200;
                  res.end(JSON.stringify({ accessToken: tokenData.accessToken }));
                } catch (error: any) {
                  console.error('Pluggy Proxy Error:', error);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: error.message }));
                }
              });
            }
          });

          // Second proxy for syncing data (Accounts & Transactions)
          server.middlewares.use('/api/pluggy-sync', async (req, res) => {
            if (req.method === 'OPTIONS') {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
              res.statusCode = 200;
              res.end();
              return;
            }
            if (req.method === 'POST') {
              let body = '';
              req.on('data', chunk => { body += chunk.toString(); });
              req.on('end', async () => {
                try {
                  const payload = body ? JSON.parse(body) : {};
                  const itemId = payload.itemId;
                  if (!itemId) throw new Error('Missing itemId');

                  const clientId = env.VITE_PLUGGY_CLIENT_ID;
                  const clientSecret = env.VITE_PLUGGY_CLIENT_SECRET;
                  if (!clientId || !clientSecret) throw new Error('Missing credentials');
                  
                  // 1. Get API Key
                  const authRes = await fetch('https://api.pluggy.ai/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId, clientSecret })
                  });
                  const authData = await authRes.json();
                  if (!authData.apiKey) throw new Error('Failed to get Pluggy API Key');
                  const apiKey = authData.apiKey;
                  const reqHeaders = { 'accept': 'application/json', 'X-API-KEY': apiKey };

                  // 2. Fetch Accounts
                  const accRes = await fetch(`https://api.pluggy.ai/accounts?itemId=${itemId}`, { headers: reqHeaders });
                  const accData = await accRes.json();
                  if (!accData.results) throw new Error('Failed to fetch accounts');

                  let allTransactions: any[] = [];
                  
                  // 3. Fetch Transactions for each account within user-specified date range
                  for (const account of accData.results) {
                    // Use user-supplied dates, or default to last 30 days
                    const defaultFrom = new Date();
                    defaultFrom.setDate(defaultFrom.getDate() - 30);
                    const startDateStr = payload.fromDate || defaultFrom.toISOString().split('T')[0];
                    const endDateStr = payload.toDate || new Date().toISOString().split('T')[0];
                    
                    const txRes = await fetch(`https://api.pluggy.ai/transactions?accountId=${account.id}&from=${startDateStr}&to=${endDateStr}`, { headers: reqHeaders });
                    const txData = await txRes.json();
                    if (txData.results) {
                        allTransactions = [...allTransactions, ...txData.results.map((tx: any) => ({ ...tx, _bankAccount: account }))];
                    }
                  }

                  res.setHeader('Content-Type', 'application/json');
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  res.statusCode = 200;
                  res.end(JSON.stringify({ 
                    accounts: accData.results,
                    transactions: allTransactions
                  }));
                } catch (error: any) {
                  console.error('Pluggy Sync Error:', error);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: error.message }));
                }
              });
            }
          });
        }
      }
    ],
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1000,
    }
  };
});
