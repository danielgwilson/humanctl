#!/usr/bin/env node
'use strict';

// docs/design-system.md section 10, gate 3: "A grep gate over a denylist of
// retired class names (bg-accent, text-muted-foreground, border-border,
// bg-sidebar-*, shadow-(xs|md|lg|2xl), rounded-(sm|md|lg)). Tailwind
// silently drops unknown classes rather than erroring, so lint is the only
// thing standing between a refactor and a hundred invisible no-ops."
//
// This is deliberately a plain text grep, not an AST rule (that's
// eslint-rules/design-system.mjs, gate 2) -- a Tailwind class name that no
// longer resolves to a real utility isn't a syntax error, it's just dead
// text, so the only way to catch it is to search for the text itself.
// Comments are stripped before matching (a simple string/comment-aware
// scanner, not a full parser) so prose that DISCUSSES a retired name --
// this repo's own header comments are full of that, e.g. "no dark:
// variants" -- never trips the gate the way a naive `grep -r` would.
//
// Wired into `npm run lint:classnames`, run in CI right next to
// `npm run tokens:check` (design-system stage 4, #70).
//
// DEVIATION FROM THE DOC'S LITERAL LIST (stated here and in the PR body):
// `rounded-(sm|md|lg)` is NOT enforced yet. Those three token names are
// still live, correctly-mapped @theme bridge keys today (globals.css's
// `--radius-sm`/`--radius-md`/`--radius-lg` are NOT part of the MAGENTA
// CANARY retired-alias block -- only the colour tokens are, see globals.css)
// and dozens of current call sites correctly use them (chip.tsx, command.tsx,
// tooltip.tsx, header.tsx, sonner.tsx, ...). Stage 5 (#71) item 10 is
// explicit that removing Tailwind's default radii from the theme happens
// "in the same PR as the primitives consuming rounded-md" -- enforcing the
// ban here, ahead of that removal, would fail on correct, unchanged code and
// force exactly the premature radius-scale rewrite issue #70 rules out
// ("This stage is NOT a rebase"). The other five patterns ARE already fully
// retired today (aliased to #ff00ff in globals.css's MAGENTA CANARY block,
// stage 2/#68) with zero live call sites, so they are enforced now.

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'electron', 'renderer-vite', 'src');

// Each entry: [label, regex]. Regexes are matched against COMMENT-STRIPPED
// source text, so they can stay simple substring/word patterns rather than
// JSX-attribute-aware AST matching.
const DENYLIST = [
  ['bg-accent', /\bbg-accent\b/],
  ['text-muted-foreground', /\btext-muted-foreground\b/],
  ['border-border', /\bborder-border\b/],
  ['bg-sidebar-*', /\bbg-sidebar(-[a-z]+)*\b/],
  ['shadow-(xs|md|lg|2xl)', /\bshadow-(xs|md|lg|2xl)\b/],
];

/**
 * Strips `//` line comments and `/* *\/` block comments from `src`, leaving
 * everything inside string/template literals untouched (so a Tailwind class
 * string that happens to contain "//" -- none do today, but the scanner
 * should not corrupt one if it ever did -- survives intact). Not a full
 * JS/TS parser: doesn't handle regex-literal `/.../ ` ambiguity, which never
 * arises in this repo's component/view files (no bare regex literals in
 * className-adjacent code). Comment regions are replaced with spaces
 * (preserving line/column count, in case a future version wants to report
 * line numbers from the stripped text directly).
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inString = null; // one of ' " ` or null
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < n) {
        out += c2;
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && c2 === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron-vite') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function main() {
  const files = walk(SRC_DIR, []);
  let failed = false;
  let checked = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const stripped = stripComments(raw);
    const lines = stripped.split('\n');
    checked += 1;

    for (const [label, re] of DENYLIST) {
      lines.forEach((line, idx) => {
        if (re.test(line)) {
          failed = true;
          console.error(`[lint:classnames] FAIL  ${path.relative(process.cwd(), file)}:${idx + 1}  retired class "${label}"`);
          console.error(`  ${line.trim()}`);
        }
      });
    }
  }

  if (checked === 0) {
    console.error(`[lint:classnames] FAIL: found zero .ts/.tsx files under ${SRC_DIR}; the gate would be vacuously passing.`);
    process.exit(1);
  }

  if (failed) {
    console.error('[lint:classnames] FAIL -- retired class name(s) found (docs/design-system.md 10.3). Tailwind drops unknown classes silently; these are dead no-ops, not just style debt.');
    process.exit(1);
  }

  console.log(`[lint:classnames] PASS -- ${checked} files checked, zero retired class names (docs/design-system.md 10.3; rounded-(sm|md|lg) deliberately deferred to stage 5, #71 -- see this script's header).`);
}

main();
