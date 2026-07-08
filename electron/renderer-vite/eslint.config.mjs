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
  // no babel-plugin-react-compiler), so these rules lint for a compiler that is
  // not in the build.
  //
  // They are nonetheless scoped to the EXACT FILES that violate them, never to
  // `src/**`. Three of them (purity, refs, set-state-in-effect) catch real React
  // bugs independent of any compiler: an impure render breaks StrictMode's double
  // render, a ref read during render ships a stale value. A `src/**` exemption
  // would have retired that signal across all 35 renderer files to excuse five
  // lines. Every violation is enumerated below; adding a new one means adding a
  // file here on purpose, with evidence.
  {
    // src/App.tsx:174 -- `lastTs: new Date(Date.now() - ageMs)` on a synthesized
    // thread. Impure, but the value is dead: the only readers of `lastTs` are
    // inbox-logic.ts's sorters over the `threads` array, and this object never
    // enters it. Purifying it needs an absolute timestamp plumbed through
    // SessionRow (which carries only `ageMs`), so it stays a scoped exemption.
    // ui/sidebar.tsx:693 -- vendored shadcn `SidebarMenuSkeleton`, `Math.random()`
    // for a skeleton bar width. Zero call sites in this app today.
    files: ['src/App.tsx', 'src/components/ui/sidebar.tsx'],
    rules: { 'react-hooks/purity': 'off' },
  },
  {
    // src/hooks/use-timeline.ts:130 -- `rowRef.current = row`, the latest-ref
    // write that lets an async callback read a fresh value without re-running the
    // effect on every 20s fleet poll. Safe here because the renderer uses no
    // concurrent features: `rg 'useTransition|startTransition|Suspense|useDeferredValue' src/`
    // returns nothing, so there is no discarded-render path to ship a stale ref.
    files: ['src/hooks/use-timeline.ts'],
    rules: { 'react-hooks/refs': 'off' },
  },
  {
    // Five sites, all of them named (an earlier version of this comment listed
    // three and quietly covered five):
    //   src/hooks/use-mobile.ts:21        matchMedia subscription
    //   src/hooks/use-humanctl.ts:60      window.humanctl IPC bridge attach
    //   src/hooks/use-humanctl.ts:123     a fetch's own loading flag
    //   src/hooks/use-timeline.ts:177     timeline page load
    //   src/components/views/settings-view.tsx:43   setBudgetInput(String(dailyBudgetUSD))
    // The first four are the ordinary "subscribe to an external system" pattern.
    // The last is NOT: it is React's documented "adjust state when a prop changes"
    // anti-pattern, costing an extra render pass on every budget change. It is
    // listed here rather than silently swept in, and is worth replacing with a
    // render-time derive or a keyed input.
    files: [
      'src/hooks/use-mobile.ts',
      'src/hooks/use-humanctl.ts',
      'src/hooks/use-timeline.ts',
      'src/components/views/settings-view.tsx',
    ],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
  {
    // Reports "Compilation Skipped" for @tanstack/react-virtual. Purely
    // informational, and meaningless without a compiler to skip.
    files: ['src/components/inbox/inbox-view.tsx', 'src/components/views/sessions-view.tsx'],
    rules: { 'react-hooks/incompatible-library': 'off' },
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
