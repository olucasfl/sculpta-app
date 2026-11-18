import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC emite os metadados de decorators que a injeção de dependência do Nest precisa.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Cada arquivo sobe o próprio Postgres em memória (PGlite).
    fileParallelism: false,
  },
});
