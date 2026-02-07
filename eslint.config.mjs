import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      'no-case-declarations': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-async-promise-executor': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
];
