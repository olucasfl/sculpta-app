/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Mesmo domínio para o front e a API: o cookie de refresh (SameSite=Strict) funciona sem CORS.
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false } },
  },
  // O chunk do simulador (three.js + drei, ~1,1 MB) só carrega ao abrir uma simulação.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Os testes de tela (Playwright) rodam por `pnpm e2e`, não pelo Vitest.
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
