import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { feedexPlugin } from './vite/feedex.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

// Dev-server proxies for APIs that don't send CORS headers.
// Production equivalents live in vercel.json / netlify.toml.
export default defineConfig(({ mode }) => ({
  plugins: [react(), feedexPlugin(mode)],
  // App version + build id — attached to feedback reports as non-sensitive context.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev'),
  },
  server: {
    proxy: {
      '/proxy/wx': {
        target: 'https://aviationweather.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/wx/, ''),
      },
      '/proxy/adsblol': {
        target: 'https://api.adsb.lol',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/adsblol/, ''),
      },
      '/proxy/adsbfi': {
        target: 'https://opendata.adsb.fi',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/adsbfi/, ''),
      },
    },
  },
}));
