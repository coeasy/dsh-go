import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'site/dist/**',
      'site/node_modules/**',
      'node_modules/**',
      'catalog/**',
      'output/**',
      '*.astro',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,mjs,js}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Headers: 'readonly',
        caches: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        structuredClone: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'off',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-console': 'off',
    },
  },
];
