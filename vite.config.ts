import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  plugins: [tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    // net/client.ts's createApi() defaults to same-origin ('' baseUrl), so
    // the dev server proxies /api rather than the client needing a separate
    // base URL or the API server needing CORS. Point at wherever `npm run
    // server:dev` (server/) is actually listening; production deployment
    // makes the same assumption via a reverse proxy or shared origin.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
