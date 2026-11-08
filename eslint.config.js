// @ts-check
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

// The project compiles with TypeScript 7 (native), which no longer ships the JS compiler API that
// typescript-eslint parses with. Point every `typescript` import made while linting at the
// TypeScript 6 API package instead. Must run before typescript-eslint is loaded, hence the dynamic import.
const ts6 = pathToFileURL(createRequire(import.meta.url).resolve('@typescript/typescript6')).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'typescript') return { url: ts6, format: 'commonjs', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { default: tseslint } = await import('typescript-eslint');

export default defineConfig(
  { ignores: ['dist/', 'node_modules/', 'coverage/', '.claude/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // Unused vars are already a compile error via noUnusedLocals/noUnusedParameters; keep `_x` escapes.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // DOM lookups of elements that index.html guarantees are idiomatic here.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['scripts/**', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
