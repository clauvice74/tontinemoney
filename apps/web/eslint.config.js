import nextPlugin from '@next/eslint-plugin-next';
import tontine from '@tontine/eslint-config';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...tontine.createConfig({
    tsconfigRootDir: import.meta.dirname,
    node: false,
    extraIgnores: ['next-env.d.ts', 'playwright-report/**', 'test-results/**'],
  }),
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
];
