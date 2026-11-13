import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['.local/**', 'node_modules/**', 'contract/target/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['public/**/*.js'], languageOptions: { globals: { document: 'readonly', fetch: 'readonly', setInterval: 'readonly' } } },
  { files: ['**/*.ts'], languageOptions: { globals: { process: 'readonly', console: 'readonly' } } },
];
