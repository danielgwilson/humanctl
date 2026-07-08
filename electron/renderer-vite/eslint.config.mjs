import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// The renderer is a separate runtime from the Next app at the repo root, and
// the root eslint config deliberately ignores `electron/**` (see
// ../../eslint.config.mjs). This is the renderer's OWN gate: the standard Vite
// React + TypeScript flat config (typescript-eslint + react-hooks +
// react-refresh), run by `npm run lint` here and by `npm run lint:renderer`
// from the repo root, which CI invokes on every PR. Before this file existed,
// the ~35 TSX/TS files under src/ -- the entire product UI -- had no lint and
// no typecheck running in any automation at all.
//
// Type-aware linting (tseslint.configs.recommendedTypeChecked) is deliberately
// NOT enabled: `npm run typecheck:renderer` already runs `tsc --noEmit` over
// exactly these files with `strict: true`, so a second type-aware pass would
// double the CI cost to re-prove what the compiler already proved.
export default tseslint.config(
  { ignores: ['dist/**', 'dist-electron-vite/**', 'node_modules/**'] },

  // The Vite / electron-vite configs run in Node, not the browser, and sit
  // outside tsconfig.json's `include` (which is `src` only).
  {
    files: ['*.config.ts', '*.config.mjs'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
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

  // eslint-plugin-react-hooks v7 folded the React Compiler rule family into its
  // `recommended` preset. This app does not run the React Compiler (vite.config
  // .ts and electron.vite.config.ts both use plain `@vitejs/plugin-react` with
  // no babel-plugin-react-compiler), so those rules are lint for a compiler
  // that is not in the build, and each one below flags correct, idiomatic React
  // here. Only the four that actually fire are disabled; the rest of the family
  // stays on, so a future violation is a real decision with real evidence
  // rather than a pre-emptive blanket exemption.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Flags `Date.now()` in a render body (App.tsx's synthesized thread
      // timestamp) and vendored shadcn Sidebar's `Math.random()` skeleton width.
      'react-hooks/purity': 'off',
      // Flags use-timeline.ts's deliberate, documented latest-ref write
      // (`rowRef.current = row`), the standard way to read a fresh value from an
      // async callback without re-running the effect on every 20s fleet poll.
      'react-hooks/refs': 'off',
      // Flags the ordinary "sync to an external system on mount" effect:
      // matchMedia (use-mobile), the window.humanctl IPC bridge (use-humanctl),
      // and a fetch's own loading flag.
      'react-hooks/set-state-in-effect': 'off',
      // Reports "Compilation Skipped" for @tanstack/react-virtual. Meaningless
      // without a compiler to skip.
      'react-hooks/incompatible-library': 'off',
    },
  },

  // shadcn primitives in `src/components/ui/` intentionally co-export their cva
  // variant objects and their context hooks (`buttonVariants`,
  // `progressIndicatorVariants`, `useSidebar`) next to the components, because
  // that is the shape shadcn's own generator emits and the shape every call
  // site imports. `react-refresh/only-export-components` is a hot-reload
  // ergonomics rule, not a correctness rule, and it cannot see that these are
  // stable non-component exports. Scoped off here rather than worked around by
  // splitting every primitive into two files.
  {
    files: ['src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
