#!/usr/bin/env node
'use strict';

// Release boundary for the public repository and CLI-only npm package.
// This checks the candidate worktree, then creates, extracts, installs, and
// smokes the exact tarball npm would publish.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXPECTED_PACKAGE_FILES = [
  '.agents/skills/humanctl/SKILL.md',
  '.agents/skills/humanctl/agents/openai.yaml',
  'dist/bin/humanctl.js',
  'dist/lib/commands.js',
  'dist/lib/pulse.js',
  'README.md',
  'LICENSE',
];
const EXPECTED_PACKED_FILES = [
  '.agents/skills/humanctl/SKILL.md',
  '.agents/skills/humanctl/agents/openai.yaml',
  'dist/bin/humanctl.js',
  'dist/lib/commands.js',
  'dist/lib/pulse.js',
  'LICENSE',
  'README.md',
  'package.json',
];

// Split the home-directory tokens so this guard does not match its own source.
const DENIED_TEXT_PATTERNS = [
  {
    label: 'macOS absolute home path',
    regex: new RegExp('/' + 'Users/[A-Za-z0-9._-]+(?:/|$)', 'g'),
  },
  {
    label: 'Windows absolute home path',
    regex: new RegExp('[A-Za-z]:\\\\' + 'Users\\\\[^\\\\\\s]+(?:\\\\|$)', 'g'),
  },
  {
    label: 'Linux absolute home path',
    // /home/dev is the repository's explicit synthetic fixture identity.
    regex: new RegExp('/' + 'home/(?!dev(?:/|$))[A-Za-z0-9._-]+(?:/|$)', 'g'),
  },
  {
    label: 'repository-local home shortcut',
    regex: new RegExp('~/(?:' + 'local_git|codex)(?:/|$)', 'g'),
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

function fail(message) {
  console.error(`[package:check] FAIL: ${message}`);
  process.exitCode = 1;
}

function nestedNpmEnv() {
  const env = { ...process.env };
  // `npm publish --dry-run` exports this config to lifecycle scripts. The
  // package gate must still create and install its own temporary tarball.
  delete env.npm_config_dry_run;
  delete env.NPM_CONFIG_DRY_RUN;
  return env;
}

function currentRepositoryFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return output.split('\0').filter((file) => file && fs.existsSync(path.join(ROOT, file)));
}

function isText(buffer) {
  return !buffer.includes(0);
}

function scanDeniedText(files, scope, baseDir = ROOT) {
  let checked = 0;
  for (const file of files) {
    const fullPath = path.join(baseDir, file);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) continue;

    const buffer = fs.readFileSync(fullPath);
    if (!isText(buffer)) continue;
    checked += 1;

    const lines = buffer.toString('utf8').split('\n');
    lines.forEach((line, index) => {
      for (const pattern of DENIED_TEXT_PATTERNS) {
        if (pattern.exclude === file) continue;
        pattern.regex.lastIndex = 0;
        if (pattern.regex.test(line)) {
          fail(`${scope} contains a ${pattern.label}: ${file}:${index + 1}`);
        }
      }
    });
  }

  if (checked === 0) fail(`${scope} scan checked zero text files`);
  return checked;
}

function packPackage() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const actualFiles = packageJson.files || [];
  if (JSON.stringify(actualFiles) !== JSON.stringify(EXPECTED_PACKAGE_FILES)) {
    fail(`package.json files must exactly equal ${JSON.stringify(EXPECTED_PACKAGE_FILES)}`);
  }
  if (Object.prototype.hasOwnProperty.call(packageJson, 'main')) {
    fail('CLI-only package must not declare a main entry point');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-package-check-'));
  let output;
  try {
    output = execFileSync(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', tempDir],
      { cwd: ROOT, env: nestedNpmEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`npm pack failed: ${detail}`);
  }

  const result = JSON.parse(output);
  if (!Array.isArray(result) || result.length !== 1 || !Array.isArray(result[0].files)) {
    throw new Error('npm pack returned an unexpected JSON manifest');
  }
  const manifest = result[0];
  const tarballPath = path.join(tempDir, manifest.filename);
  if (!fs.existsSync(tarballPath)) throw new Error(`npm pack did not create ${manifest.filename}`);

  const packageRoot = path.join(tempDir, 'extracted', 'package');
  fs.mkdirSync(path.dirname(packageRoot), { recursive: true });
  execFileSync('tar', ['-xzf', tarballPath, '-C', path.dirname(packageRoot)]);
  return { manifest, packageRoot, tarballPath, tempDir };
}

function smokeInstall(tarballPath, tempDir) {
  const installDir = path.join(tempDir, 'install');
  const homeDir = path.join(tempDir, 'home');
  const workspaceDir = path.join(tempDir, 'workspace');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  execFileSync(
    'npm',
    ['install', '--prefix', installDir, '--ignore-scripts', '--no-audit', '--no-fund', tarballPath],
    { cwd: tempDir, env: nestedNpmEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const bin = path.join(installDir, 'node_modules', '.bin', 'humanctl');
  const env = { ...process.env, HOME: homeDir };
  const help = execFileSync(bin, ['--help'], { cwd: workspaceDir, env, encoding: 'utf8' });
  if (!help.startsWith('humanctl\n\nUsage:')) throw new Error('installed CLI help smoke returned unexpected output');

  execFileSync(bin, ['init', workspaceDir], { cwd: workspaceDir, env, encoding: 'utf8' });
  const status = JSON.parse(
    execFileSync(bin, ['status', workspaceDir, '--json'], { cwd: workspaceDir, env, encoding: 'utf8' }),
  );
  if (!status || typeof status !== 'object') throw new Error('installed CLI status smoke returned invalid JSON');

  execFileSync(bin, ['note', '--level', 'fyi', 'package smoke'], {
    cwd: workspaceDir,
    env,
    encoding: 'utf8',
  });
  if (!fs.existsSync(path.join(homeDir, '.humanctl', 'notes.jsonl'))) {
    throw new Error('installed CLI note smoke did not write inside the isolated HOME');
  }
}

function main() {
  const repositoryFiles = currentRepositoryFiles();
  const repositoryTextFiles = scanDeniedText(repositoryFiles, 'repository');
  const packed = packPackage();
  try {
    const packedFiles = packed.manifest.files.map((entry) => entry.path).sort();
    const expectedFiles = [...EXPECTED_PACKED_FILES].sort();
    if (JSON.stringify(packedFiles) !== JSON.stringify(expectedFiles)) {
      fail(
        `npm package paths differ from the exact allowlist\n` +
          `  expected: ${JSON.stringify(expectedFiles)}\n` +
          `  actual:   ${JSON.stringify(packedFiles)}`,
      );
    }

    const packageTextFiles = scanDeniedText(packedFiles, 'npm package', packed.packageRoot);
    if (!process.exitCode) smokeInstall(packed.tarballPath, packed.tempDir);

    if (process.exitCode) return;
    console.log(
      `[package:check] PASS: ${repositoryTextFiles} repository text files scanned; ` +
        `${packedFiles.length} exact npm files; ${packageTextFiles} packed text files scanned; ` +
        `clean install and CLI smoke passed; zero denied content; ${packed.manifest.integrity}`,
    );
  } finally {
    fs.rmSync(packed.tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
