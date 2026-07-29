#!/usr/bin/env node
'use strict';

// Registry source debt gate. Tailwind accepts unknown utility names without
// reporting an error, so retired namespaces need a separate text check. This
// scanner deliberately permits current token-backed utilities such as
// border-border, bg-accent-soft, rounded-[var(...)], and shadow-[var(...)].

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'packages', 'ui', 'src');
const SOURCE_FILE = /\.(css|ts|tsx)$/;

const RULES = [
  {
    label: 'retired surface namespace',
    pattern: /\b(?:bg|text|border|ring)-(?:card|popover|muted|secondary)(?:-[a-z0-9-]+)?\b/,
    example: 'bg-card',
  },
  {
    label: 'retired generic accent fill',
    pattern: /\bbg-accent(?!-)/,
    example: 'bg-accent',
  },
  {
    label: 'retired named shadow utility',
    pattern: /\bshadow-(?:xs|sm|md|lg|xl|2xl)\b/,
    example: 'shadow-lg',
  },
  {
    label: 'component-local dark variant',
    pattern: /\bdark:/,
    example: 'dark:bg-black',
  },
  {
    label: 'retired visual token namespace',
    pattern: /\b(?:iris|graphite|violet)(?:-[a-z0-9-]+)?\b/i,
    example: 'violet-contrast',
  },
];

function stripComments(source) {
  let output = '';
  let cursor = 0;
  let quote = null;
  while (cursor < source.length) {
    const current = source[cursor];
    const next = source[cursor + 1];
    if (quote) {
      output += current;
      if (current === '\\' && cursor + 1 < source.length) {
        output += next;
        cursor += 2;
        continue;
      }
      if (current === quote) quote = null;
      cursor += 1;
      continue;
    }
    if (current === '"' || current === "'" || current === '`') {
      quote = current;
      output += current;
      cursor += 1;
      continue;
    }
    if (current === '/' && next === '/') {
      while (cursor < source.length && source[cursor] !== '\n') {
        output += ' ';
        cursor += 1;
      }
      continue;
    }
    if (current === '/' && next === '*') {
      output += '  ';
      cursor += 2;
      while (cursor < source.length && !(source[cursor] === '*' && source[cursor + 1] === '/')) {
        output += source[cursor] === '\n' ? '\n' : ' ';
        cursor += 1;
      }
      if (cursor < source.length) {
        output += '  ';
        cursor += 2;
      }
      continue;
    }
    output += current;
    cursor += 1;
  }
  return output;
}

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target, files);
    else if (SOURCE_FILE.test(entry.name)) files.push(target);
  }
  return files;
}

function findingsFor(source) {
  const findings = [];
  const lines = stripComments(source).split('\n');
  for (const [index, line] of lines.entries()) {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) findings.push({ line: index + 1, rule, text: line.trim() });
    }
  }
  return findings;
}

function selftest() {
  const clean = 'border-border bg-accent-soft rounded-[var(--radius-2)] shadow-[var(--elev-overlay)]';
  if (findingsFor(clean).length !== 0) throw new Error('current Registry utility fixture produced a finding');
  for (const rule of RULES) {
    const findings = findingsFor(`const fixture = "${rule.example}";`);
    if (!findings.some((finding) => finding.rule === rule)) {
      throw new Error(`negative fixture did not trigger ${rule.label}`);
    }
  }
  console.log(`[lint:classnames] selftest passed (${RULES.length} rules proved)`);
}

function main() {
  if (process.argv.includes('--selftest')) {
    selftest();
    return;
  }
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`[lint:classnames] FAIL: source directory is missing: ${SRC_DIR}`);
    process.exit(1);
  }
  const files = walk(SRC_DIR).sort();
  if (files.length === 0) {
    console.error(`[lint:classnames] FAIL: found zero source files under ${SRC_DIR}`);
    process.exit(1);
  }

  let failures = 0;
  for (const file of files) {
    for (const finding of findingsFor(fs.readFileSync(file, 'utf8'))) {
      failures += 1;
      console.error(`[lint:classnames] FAIL  ${path.relative(process.cwd(), file)}:${finding.line}  ${finding.rule.label}`);
      console.error(`  ${finding.text}`);
    }
  }
  if (failures > 0) {
    console.error(`[lint:classnames] FAIL: ${failures} retired utility or token reference${failures === 1 ? '' : 's'} found`);
    process.exit(1);
  }
  console.log(`[lint:classnames] PASS: ${files.length} Registry source files checked against ${RULES.length} active debt rules`);
}

main();
