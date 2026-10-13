import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.NIMBUS_API_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 5173),
    strictPort: false,
    // The preview host is dynamic ({port}-{sandboxId}.e2b.app) — accept any origin.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // Browse endpoints can stream large payloads / long responses.
        proxyTimeout: 120_000,
        timeout: 120_000,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 5173),
    allowedHosts: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
