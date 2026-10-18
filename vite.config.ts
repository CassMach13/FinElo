import path from 'path';
import { defineConfig, loadEnv, ConfigEnv } from 'vite';
import react from '@vitejs/plugin-react';
import openFinancePaused, { OPEN_FINANCE_PATHS } from './server/open-finance-paused.js';

import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }: ConfigEnv) => {
  const env = loadEnv(mode, process.cwd(), 'GEMINI_API_KEY');
  const projectRootDir = path.resolve(__dirname);
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      // Let the pause handler answer OPTIONS on the five provider routes too.
      cors: { preflightContinue: true },
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
          // Screenshots da Central de Ajuda carregam sob demanda; não entram no download inicial do app.
          globIgnores: ['**/node_modules/**/*', 'demo-video.mp4', 'logo/FinElo_Banner_Youtube.png', 'help/**'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
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
            }
          ]
        }
      }),
      {
        name: 'open-finance-paused',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '');
            if (OPEN_FINANCE_PATHS.includes(pathname)) {
              openFinancePaused(req, res);
              return;
            }
            // Preserve Vite's default preflight response for unrelated routes.
            if (req.method === 'OPTIONS') {
              res.statusCode = 204;
              res.setHeader('Content-Length', '0');
              res.end();
              return;
            }
            next();
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
