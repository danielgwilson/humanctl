import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// The Electron renderer and packages/ui are one browser lint surface. The
// root Next.js config ignores both trees. Type-aware rules stay off because
// their dedicated TypeScript checks already run in CI.
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron-vite/**',
      'node_modules/**',
      '../../packages/ui/node_modules/**',
      '../../packages/ui/dist-catalog/**',
      'electron/renderer-vite/dist/**',
      'electron/renderer-vite/dist-electron-vite/**',
      'electron/renderer-vite/node_modules/**',
      'packages/ui/node_modules/**',
      'packages/ui/dist-catalog/**',
    ],
  },

  {
    files: ['*.config.ts', '*.config.mjs', 'electron/renderer-vite/*.config.ts', 'electron/renderer-vite/*.config.mjs'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  {
    files: [
      'src/**/*.{ts,tsx}',
      '../../packages/ui/src/**/*.{ts,tsx}',
      'electron/renderer-vite/src/**/*.{ts,tsx}',
      'packages/ui/src/**/*.{ts,tsx}',
    ],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },

  // These two primitives intentionally co-export stable variant helpers with
  // their components. The refresh rule is an HMR ergonomics check, and these
  // exact co-exports were verified after moving visual ownership into the
  // Registry package.
  {
    files: [
      '../../packages/ui/src/components/button.tsx',
      '../../packages/ui/src/components/toggle.tsx',
      'packages/ui/src/components/button.tsx',
      'packages/ui/src/components/toggle.tsx',
    ],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
