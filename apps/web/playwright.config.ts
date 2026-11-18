import { defineConfig } from '@playwright/test';

/**
 * Testes de tela nos 5 viewports do guia (docs/GUIA-REFORMULACAO.md, seção 7). Rodam contra a pilha
 * isolada que `pnpm --filter @sim/web e2e` sobe (banco temporário, nunca o Supabase).
 * O Playwright usa Chromium emulando os tamanhos: NÃO substitui testar em iPhone e Android reais.
 */
const phone = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 2,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5174',
    locale: 'pt-BR',
    trace: 'off',
  },
  projects: [
    { name: 'iphone-375x812', use: { viewport: { width: 375, height: 812 }, ...phone } },
    { name: 'android-390x844', use: { viewport: { width: 390, height: 844 }, ...phone } },
    { name: 'tablet-retrato-768x1024', use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'tablet-paisagem-1024x768', use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
    { name: 'desktop-1440x900', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
