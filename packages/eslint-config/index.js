// Configuration ESLint partagée (flat config).
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const importX = require('eslint-plugin-import-x');
const globals = require('globals');

/**
 * Interdit l'import des chemins internes d'un autre package du monorepo :
 * seuls les points d'entrée publics (`@tontine/<pkg>`) sont autorisés.
 */
const noInternalImports = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['@tontine/*/src/*', '@tontine/*/dist/*'],
          message: 'Importer uniquement le point d’entrée public du package (@tontine/<pkg>).',
        },
        {
          group: [
            '../../services/*',
            '../../../services/*',
            '../../packages/*',
            '../../../packages/*',
          ],
          message: 'Import relatif inter-package interdit : utiliser @tontine/<pkg>.',
        },
      ],
    },
  ],
};

function createConfig({ tsconfigRootDir, node = true, extraIgnores = [] } = {}) {
  return tseslint.config(
    {
      ignores: [
        'eslint.config.js',
        '*.config.mjs',
        '**/generated/**',
        'scripts/**/*.mjs',
        'dist/**',
        '.next/**',
        'coverage/**',
        'node_modules/**',
        ...extraIgnores,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: ['**/*.ts', '**/*.tsx'],
      languageOptions: {
        parserOptions: { tsconfigRootDir },
        globals: node ? { ...globals.node } : { ...globals.browser },
      },
      plugins: { 'import-x': importX },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        'import-x/no-duplicates': 'error',
        'no-console': ['error', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'always'],
        ...noInternalImports,
      },
    },
    {
      files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/test/**/*.ts'],
      rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },
  );
}

module.exports = { createConfig };
