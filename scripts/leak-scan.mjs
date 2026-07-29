#!/usr/bin/env node
// Commit-time and CI leak gate for the public repository.
//
// Modes:
//   --staged    scan lines being ADDED by the staged diff; the pre-commit
//               hook runs this so denied content never enters history
//   --repo      scan every tracked and untracked-but-not-ignored text file
//   --selftest  prove the matcher catches known-bad and passes known-good
//
// The pattern list lives in scripts/leak-patterns.js and is shared with
// scripts/package-hygiene-check.js. Zero dependencies.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DENIED_TEXT_PATTERNS } = require('./leak-patterns.js');

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.tgz', '.gz', '.dmg', '.asar', '.node', '.wasm',
  '.pdf', '.mp4', '.mov', '.webm',
]);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function matchLine(line, file) {
  const hits = [];
  for (const pattern of DENIED_TEXT_PATTERNS) {
    if (pattern.exclude === file) continue;
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(line)) hits.push(pattern.label);
  }
  return hits;
}

function isBinaryPath(file) {
  const dot = file.lastIndexOf('.');
  return dot !== -1 && BINARY_EXTENSIONS.has(file.slice(dot).toLowerCase());
}

function report(findings, mode) {
  if (findings.length === 0) {
    console.log(`[leak-scan] ${mode}: clean`);
    return 0;
  }
  console.error(`[leak-scan] ${mode}: ${findings.length} denied line(s):`);
  for (const f of findings.slice(0, 40)) {
    console.error(`  ${f.file}:${f.line} [${f.labels.join(', ')}] ${f.text.slice(0, 120)}`);
  }
  if (findings.length > 40) console.error(`  ... and ${findings.length - 40} more`);
  console.error(
    '[leak-scan] This repository is public. Remove the personal or secret ' +
      'content, or move it outside the repo (see AGENTS.md Hygiene). The ' +
      'denylist lives in scripts/leak-patterns.js.'
  );
  return 1;
}

function scanStaged() {
  const diff = git(['diff', '--cached', '--no-color', '--unified=0']);
  const findings = [];
  let file = null;
  let lineNo = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      file = raw.slice(6);
      continue;
    }
    if (raw.startsWith('+++')) {
      file = null;
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = /\+([0-9]+)/.exec(raw);
      lineNo = m ? Number(m[1]) - 1 : 0;
      continue;
    }
    if (!raw.startsWith('+') || file === null || isBinaryPath(file)) continue;
    lineNo += 1;
    const text = raw.slice(1);
    const labels = matchLine(text, file);
    if (labels.length > 0) findings.push({ file, line: lineNo, labels, text });
  }
  return report(findings, 'staged');
}

function scanRepo() {
  const tracked = git(['ls-files']).split('\n');
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n');
  const files = [...new Set([...tracked, ...untracked])].filter(
    (f) => f.length > 0 && !isBinaryPath(f)
  );
  const findings = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file);
    } catch {
      continue;
    }
    if (content.includes(0)) continue;
    const lines = content.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const labels = matchLine(lines[i], file);
      if (labels.length > 0) {
        findings.push({ file, line: i + 1, labels, text: lines[i] });
      }
    }
  }
  console.log(`[leak-scan] repo: ${files.length} text files scanned`);
  return report(findings, 'repo');
}

function selftest() {
  // Positive and negative cases are built by concatenation at runtime so this
  // file never contains a denied literal.
  const home = '/' + 'Users/' + 'someone' + '/repo/file.ts';
  const positives = [
    [home, 'macOS absolute home path'],
    ['see /' + 'Users/' + 'someone' + ' for notes', 'macOS absolute home path'],
    ['C:\\' + 'Users\\' + 'someone\\repo', 'Windows absolute home path'],
    ['/' + 'home/' + 'someone' + '/repo', 'Linux absolute home path'],
    ['~/' + 'local_git' + '/x', 'repository-local home shortcut'],
    ['cd ~/' + 'local_git' + ' && npm test', 'repository-local home shortcut'],
    ['~/' + 'codex' + '/brain', 'repository-local home shortcut'],
    ['legion' + '.' + 'health', 'owner employer domain'],
    ['from the Pla' + 'ud recorder', 'recorder vendor name'],
    ['gh' + 'p_' + 'a'.repeat(36), 'GitHub token shape'],
    ['sk-' + 'ant-' + 'a'.repeat(24), 'Anthropic key shape'],
    ['npm' + '_' + 'a'.repeat(36), 'npm token shape'],
  ];
  const negatives = [
    '/' + 'home/dev/workspace/file.ts',
    'github.com/danielgwilson/humanctl',
    'the audience applauded loudly',
    'plaudits were given',
    'Users of the app can resume sessions',
    'a normal line of code',
  ];
  let failures = 0;
  for (const [text, expected] of positives) {
    const labels = matchLine(text, 'synthetic.txt');
    if (!labels.includes(expected)) {
      console.error(`[leak-scan] selftest FAIL: expected [${expected}] for: ${text}`);
      failures += 1;
    }
  }
  for (const text of negatives) {
    const labels = matchLine(text, 'synthetic.txt');
    if (labels.length > 0) {
      console.error(`[leak-scan] selftest FAIL: false positive [${labels.join(', ')}] for: ${text}`);
      failures += 1;
    }
  }
  const excluded = matchLine('BEGIN RSA ' + 'PRIVATE KEY', 'scripts/secret-scan.sh');
  if (excluded.length > 0) {
    console.error('[leak-scan] selftest FAIL: exclude field was not honored');
    failures += 1;
  }
  if (failures > 0) {
    console.error(`[leak-scan] selftest: ${failures} failure(s)`);
    return 1;
  }
  console.log(
    `[leak-scan] selftest: ${positives.length} positives caught, ` +
      `${negatives.length} negatives clean, exclude honored`
  );
  return 0;
}

const mode = process.argv[2];
if (mode === '--staged') process.exit(scanStaged());
else if (mode === '--repo') process.exit(scanRepo());
else if (mode === '--selftest') process.exit(selftest());
else {
  console.error('usage: leak-scan.mjs --staged | --repo | --selftest');
  process.exit(2);
}
