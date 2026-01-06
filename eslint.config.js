import globals from 'globals';
import pluginJs from '@eslint/js';
import configPrettier from 'eslint-config-prettier';

export default [
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser, // For the HTML generation strings if needed, though mostly node
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  pluginJs.configs.recommended,
  {
    rules: {
      curly: ['error', 'all'],
      'no-unused-vars': ['warn'],
      'no-undef': 'error',
      'nonblock-statement-body-position': ['error', 'below'],
      'prefer-const': 'warn',
    },
  },
  configPrettier,
];
