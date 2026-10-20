import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'nest/**', 'node_modules/**']
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react/jsx-uses-vars': 'error',
      // ⚠️ USE-BEFORE-DECLARATION IS A BLANK PAGE, AND NO BUILD SEES IT.
      //
      // Measured 2026-10-20, twice in one evening on /status/meta-stack-explorer:
      //   ReferenceError: Cannot access 'scored' before initialization
      //   ReferenceError: Cannot access 'allProtocolsData' before initialization
      // Both files COMPILED and BUILT cleanly — `tsc` and Vite accept a temporal-dead-zone read
      // because it is an execution-order fault, not a type error. The owner found each one by
      // reloading the page.
      //
      // `variables: true` flags a `const`/`let` read before its declaration in the same scope,
      // which is exactly the fault: `useMemo(fn, [deps])` evaluates the deps array immediately.
      // `functions: false` is required — function declarations hoist, so flagging them is noise.
      // Measured across all of `src/`: ZERO current violations, so this adds no debt and closes
      // the class for good.
      //
      // ⚠️ A hand-rolled source scanner was tried first and FAILED ITS OWN CANARIES — it missed a
      // real violation and mis-read arrow bodies without braces. Use the parser; do not rebuild it.
      'no-use-before-define': ['error', { variables: true, functions: false, classes: false }],
      ...reactHooksPlugin.configs.recommended.rules
    }
  }
];
