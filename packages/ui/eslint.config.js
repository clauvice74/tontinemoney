import tontine from '@tontine/eslint-config';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...tontine.createConfig({ tsconfigRootDir: import.meta.dirname, node: false }),
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
];
