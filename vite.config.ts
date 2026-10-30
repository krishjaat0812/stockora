import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite runs this config in Node, which is not part of the browser typecheck.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Cloud previews reach the dev server through a generated hostname, so the
    // allow-list is read from the environment instead of being hardcoded here.
    allowedHosts: (process.env.VITE_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    proxy: {
      // The API (and its session cookie) runs on the local Worker via wrangler.
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
});
