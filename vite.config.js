import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-server proxies for APIs that don't send CORS headers.
// Production equivalents live in vercel.json / netlify.toml.
export default defineConfig({
  plugins: [react()],
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
});
