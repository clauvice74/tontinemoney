import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Tests avec PostgreSQL (base de test migrée par le setup global partagé). */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.e2e-spec.ts'],
    fileParallelism: false,
    globalSetup: ['../../packages/database/scripts/test-global-setup.mjs'],
    testTimeout: 30_000,
  },
});
