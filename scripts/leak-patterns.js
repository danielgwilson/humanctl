'use strict';

// Single source of truth for content that must never appear in this public
// repository: personal machine topology, owner-identifying residue, and
// credential shapes. Consumed by scripts/package-hygiene-check.js (repo scan
// plus packed-tarball scan), scripts/leak-scan.mjs (commit-time and CI scan),
// and their selftests.
//
// Every literal is split across string concatenations so this file never
// matches its own patterns. Extend the list the same way; a joined literal
// here would flag every scan that reads this file.

const DENIED_TEXT_PATTERNS = [
  {
    // No trailing anchor: "/Us" + "ers/name readme" mid-sentence must still
    // match, not only path-shaped occurrences ending in a slash.
    label: 'macOS absolute home path',
    regex: new RegExp('/' + 'Users/[A-Za-z0-9._-]+', 'g'),
  },
  {
    label: 'Windows absolute home path',
    regex: new RegExp('[A-Za-z]:\\\\' + 'Users\\\\[^\\\\\\s]+', 'g'),
  },
  {
    label: 'Linux absolute home path',
    // /home/dev is the repository's explicit synthetic fixture identity.
    regex: new RegExp('/' + 'home/(?!dev\\b)[A-Za-z0-9._-]+', 'g'),
  },
  {
    label: 'repository-local home shortcut',
    regex: new RegExp('~/(?:' + 'local_git|codex)\\b', 'g'),
  },
  {
    label: 'named personal fixture residue',
    regex: new RegExp('daniel-' + 'loop-feedback', 'gi'),
  },
  {
    label: 'owner-specific private strategy residue',
    regex: new RegExp('Daniel' + '-specific', 'g'),
  },
  {
    label: 'owner employer domain',
    regex: new RegExp('legion' + '\\.' + 'health', 'gi'),
  },
  {
    label: 'recorder vendor name',
    regex: new RegExp('\\bpla' + 'ud\\b', 'gi'),
  },
  {
    label: 'private key marker',
    regex: new RegExp('BEGIN [A-Z ]*' + 'PRIVATE KEY', 'g'),
    exclude: 'scripts/secret-scan.sh',
  },
  {
    label: 'AWS access key shape',
    regex: new RegExp('AK' + 'IA[0-9A-Z]{16}', 'g'),
    exclude: 'scripts/secret-scan.sh',
  },
  {
    label: 'GitHub token shape',
    regex: new RegExp('gh' + '[pousr]_[A-Za-z0-9]{36,}', 'g'),
    exclude: 'scripts/secret-scan.sh',
  },
  {
    label: 'Slack token shape',
    regex: new RegExp('xox' + '[baprs]-[A-Za-z0-9-]{10,}', 'g'),
    exclude: 'scripts/secret-scan.sh',
  },
  {
    label: 'Anthropic key shape',
    regex: new RegExp('sk-' + 'ant-[A-Za-z0-9_-]{20,}', 'g'),
    exclude: 'scripts/secret-scan.sh',
  },
  {
    label: 'API key shape',
    regex: new RegExp('sk-' + '[A-Za-z0-9]{32,}', 'g'),
    exclude: 'scripts/secret-scan.sh',
  },
  {
    label: 'npm token shape',
    regex: new RegExp('npm_' + '[A-Za-z0-9]{36,}', 'g'),
    exclude: 'scripts/secret-scan.sh',
  },
];

module.exports = { DENIED_TEXT_PATTERNS };
