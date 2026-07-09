// Custom lint rules mechanizing docs/design-system.md section 10
// ("Enforcement"), items 2 and 3's eslint half (the grep-gate half lives in
// scripts/design-lint-classnames.js). Wired into eslint.config.mjs, scoped to
// src/components/**/*.{ts,tsx} (design-system.md 10.2: "over
// electron/renderer-vite/src/components and src/views" -- this repo nests
// views under components/views, so one glob covers both).
//
// Every rule here inspects real AST nodes (string Literals, JSXOpeningElement
// tags), never raw file text, specifically so a comment that MENTIONS a
// banned pattern (globals.css-style "no dark: variants" prose, of which this
// codebase has plenty) never trips the gate. A text-grep version of these
// rules would have false-positived on its own documentation.

/**
 * True if `node` (a Literal or TemplateElement) sits inside something that
 * plausibly authors a Tailwind class string: a JSX `className`/`class`
 * attribute, a call to `cn`/`cva`/`clsx` (including a cva() variants
 * object's nested string values, which are still inside that call's
 * arguments), or a per-slot `classNames: {...}` object (sonner's Toaster
 * `toastOptions.classNames`, the one call site in this app that authors
 * Tailwind strings as object VALUES rather than through className or a
 * cn()-family call). Walking ancestors rather than checking the immediate
 * parent catches conditional expressions (`x ? 'a' : 'b'`), array elements,
 * and nested object values -- all real shapes this codebase uses.
 */
function isClassLikeString(node, ancestors) {
  for (const anc of ancestors) {
    if (
      anc.type === 'JSXAttribute' &&
      anc.name &&
      anc.name.type === 'JSXIdentifier' &&
      // `className`/`class` plus the `*ClassName` convention this codebase's
      // own primitives use for forwarding a class to an inner element (e.g.
      // ScrollArea's `viewportClassName`, metrics/fleet/settings-view.tsx) --
      // still a Tailwind class string, just handed to a custom prop instead
      // of the DOM's own `className`.
      (anc.name.name === 'className' || anc.name.name === 'class' || /ClassName$/.test(anc.name.name))
    ) {
      return true;
    }
    if (
      anc.type === 'CallExpression' &&
      anc.callee &&
      anc.callee.type === 'Identifier' &&
      (anc.callee.name === 'cn' || anc.callee.name === 'cva' || anc.callee.name === 'clsx')
    ) {
      return true;
    }
    if (
      anc.type === 'Property' &&
      anc.key &&
      ((anc.key.type === 'Identifier' && anc.key.name === 'classNames') ||
        (anc.key.type === 'Literal' && anc.key.value === 'classNames'))
    ) {
      return true;
    }
  }
  return false;
}

// `context` is captured from each rule's `create(context)` closure -- ESLint
// invokes visitor methods without binding `this` to the rule context, so the
// ancestor lookup has to come from the closed-over `context`, never `this`.
function classStringVisitors(context, check) {
  return {
    Literal(node) {
      if (typeof node.value !== 'string') return;
      const ancestors = context.sourceCode.getAncestors(node);
      if (!isClassLikeString(node, ancestors)) return;
      check(node, node.value);
    },
    TemplateElement(node) {
      const raw = node.value && node.value.raw;
      if (typeof raw !== 'string' || raw.length === 0) return;
      const ancestors = context.sourceCode.getAncestors(node);
      if (!isClassLikeString(node, ancestors)) return;
      check(node, raw);
    },
  };
}

// section 10.2, bullet 1: "any arbitrary Tailwind value whose contents match
// a bare length literal, \[[-0-9.]+(px|rem|em)\]. [var(--token)] is
// explicitly allowed."
const BARE_LENGTH_RE = /\[(-?[0-9]+(?:\.[0-9]+)?)(px|rem|em)\]/g;

const noArbitraryLength = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'reject bare-length Tailwind arbitrary values ([Npx]/[Nrem]/[Nem]); use a named @theme token via [var(--token)] instead (docs/design-system.md 10.2)',
    },
    schema: [],
  },
  create(context) {
    return classStringVisitors(context, function check(node, value) {
      BARE_LENGTH_RE.lastIndex = 0;
      let m;
      while ((m = BARE_LENGTH_RE.exec(value))) {
        context.report({
          node,
          message: `Bare-length arbitrary value "[${m[1]}${m[2]}]" is banned (docs/design-system.md 10.2). Extract a named @theme token and use [var(--token)], or use a permitted step utility.`,
        });
      }
    });
  },
};

// section 10.2, bullet 2: "any spacing utility outside the permitted steps
// 0.5 1 1.5 2 2.5 3 4 6." Scoped to true CSS-box-model spacing (padding,
// margin, gap) per docs/design-system.md 3.1 ("Bands, rows, and controls
// snap to the 4px control rhythm" -- a SEPARATE, wider-range grid from
// general spacing). Control heights/widths (w-*, h-*, size-*) are governed
// by the control-height table (3.2) and the 12 named shell tokens (3.3)
// instead, not this 8-step allowlist: forcing every h-7/h-8 control height
// onto this list would contradict 3.2's own canonical table, which uses
// 28px/32px control heights that are not on it.
const PERMITTED_STEPS = new Set(['0', '0.5', '1', '1.5', '2', '2.5', '3', '4', '6']);
const SPACING_STEP_RE =
  /(^|[\s:])(-?)(gap-x|gap-y|space-x|space-y|gap|p[xytrbl]?|m[xytrbl]?)-([0-9]+(?:\.[0-9]+)?)(?=\s|$)/g;

const spacingSteps = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'restrict padding/margin/gap utilities to the eight permitted spacing steps (docs/design-system.md 3.1, 10.2)',
    },
    schema: [],
  },
  create(context) {
    return classStringVisitors(context, function check(node, value) {
      SPACING_STEP_RE.lastIndex = 0;
      let m;
      while ((m = SPACING_STEP_RE.exec(value))) {
        const [, , sign, prefix, step] = m;
        if (PERMITTED_STEPS.has(step)) continue;
        context.report({
          node,
          message: `Spacing utility "${sign}${prefix}-${step}" is outside the eight permitted steps (0.5 1 1.5 2 2.5 3 4 6; docs/design-system.md 3.1).`,
        });
      }
    });
  },
};

// section 10.2, bullet 3: "any dark: variant" -- the app themes via a
// `.light` class on <html> (never OS prefers-color-scheme), so `dark:` can
// never fire; see button.tsx's header comment.
const DARK_VARIANT_RE = /(^|\s)dark:/;

const noDarkVariant = {
  meta: {
    type: 'problem',
    docs: { description: 'ban dark: variants; the app themes via .light on <html>, dark: can never fire (docs/design-system.md 10.2)' },
    schema: [],
  },
  create(context) {
    return classStringVisitors(context, function check(node, value) {
      if (DARK_VARIANT_RE.test(value)) {
        context.report({ node, message: 'dark: variant is banned (docs/design-system.md 10.2): the app themes via .light on <html>, so dark: can never fire.' });
      }
    });
  },
};

// section 10.2, bullet 3 (cont'd): "any font-bold, any font-semibold outside
// the two roles" -- the six type roles (2.3) already bake their own
// font-weight in; only text-title and text-label are 600-weight roles, so
// font-semibold is tolerated ONLY alongside one of those two role classes in
// the same string, and font-bold is banned outright (no role is bold).
const FONT_BOLD_RE = /(^|\s)font-bold(\s|$)/;
const FONT_SEMIBOLD_RE = /(^|\s)font-semibold(\s|$)/;
const PERMITTED_SEMIBOLD_ROLE_RE = /text-title|text-label/;

const noHeavyWeight = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'ban font-bold outright and font-semibold outside the title/label type roles (docs/design-system.md 10.2)',
    },
    schema: [],
  },
  create(context) {
    return classStringVisitors(context, function check(node, value) {
      if (FONT_BOLD_RE.test(value)) {
        context.report({ node, message: 'font-bold is banned (docs/design-system.md 10.2): no type role is bold; weight comes from the role token.' });
      }
      if (FONT_SEMIBOLD_RE.test(value) && !PERMITTED_SEMIBOLD_ROLE_RE.test(value)) {
        context.report({
          node,
          message: 'font-semibold is banned outside the title/label roles (docs/design-system.md 10.2): those two roles already bake in weight 600.',
        });
      }
    });
  },
};

// section 10.2, bullet 4: "any outline-none" -- a cva base string's
// outline-none lands in @layer utilities and beats the shared @layer base
// :focus-visible rule, silently deleting every visible keyboard focus
// indicator (WCAG 2.4.7).
const OUTLINE_NONE_RE = /(^|\s)outline-none(\s|$)/;

const noOutlineNone = {
  meta: {
    type: 'problem',
    docs: {
      description: 'ban outline-none; it beats the shared @layer base :focus-visible rule and deletes keyboard focus (docs/design-system.md 10.2)',
    },
    schema: [],
  },
  create(context) {
    return classStringVisitors(context, function check(node, value) {
      if (OUTLINE_NONE_RE.test(value)) {
        context.report({ node, message: 'outline-none is banned (docs/design-system.md 10.2): it silently deletes the global :focus-visible ring. Use outline-hidden (Tailwind v4) if the intent is a Radix-managed focus ring instead.' });
      }
    });
  },
};

// section 10.2, bullet 5 + section 3.4: "a bare lucide-react import outside
// components/ui/icon.tsx." The violation is RENDERING a lucide component
// directly as a JSX element (bypassing Icon's strokeWidth/size choke point),
// not merely importing the component reference -- every view in this app
// imports icon components from lucide-react and hands the reference to
// <Icon icon={X} />, which is the sanctioned pattern (see nav-sidebar.tsx,
// header.tsx, command-palette.tsx, and the *-view.tsx files). Only a
// same-file `import type { LucideIcon }` (a type, never rendered) or an
// identifier that is actually opened as a JSX tag counts.
const noBareLucideRender = {
  meta: {
    type: 'problem',
    docs: {
      description: 'ban rendering a lucide-react icon component directly as JSX outside components/ui/icon.tsx; wrap it with <Icon icon={X} /> (docs/design-system.md 3.4, 10.2)',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    if (filename.replace(/\\/g, '/').endsWith('components/ui/icon.tsx')) {
      return {};
    }
    const localNames = new Set();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'lucide-react') return;
        if (node.importKind === 'type') return;
        for (const spec of node.specifiers) {
          if (spec.type !== 'ImportSpecifier') continue;
          if (spec.importKind === 'type') continue;
          localNames.add(spec.local.name);
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        if (!localNames.has(node.name.name)) return;
        context.report({
          node,
          message: `<${node.name.name} /> renders a lucide-react icon directly outside components/ui/icon.tsx (docs/design-system.md 3.4). Wrap it with <Icon icon={${node.name.name}} /> instead.`,
        });
      },
    };
  },
};

const plugin = {
  meta: { name: 'humanctl-design-system' },
  rules: {
    'no-arbitrary-length': noArbitraryLength,
    'spacing-steps': spacingSteps,
    'no-dark-variant': noDarkVariant,
    'no-heavy-weight': noHeavyWeight,
    'no-outline-none': noOutlineNone,
    'no-bare-lucide-render': noBareLucideRender,
  },
};

export default plugin;
