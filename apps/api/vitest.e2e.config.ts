import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Tests d'API de bout en bout (Nest + Postgres de test, aucun service externe réel). */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    globalSetup: ['../../packages/database/scripts/test-global-setup.mjs'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: [
        '../../services/*/src/**/*.ts',
        '../../packages/platform/src/**/*.ts',
        'src/**/*.ts',
      ],
      exclude: ['**/*.spec.ts', '**/index.ts'],
    },
  },
});
