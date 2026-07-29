#!/usr/bin/env node
// Arms the tracked commit-time leak gate (scripts/git-hooks/pre-commit) by
// pointing core.hooksPath at the tracked hooks directory. Runs from the npm
// "prepare" script. A checkout without git (a published tarball, a CI cache
// extract) is a silent no-op.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

try {
  if (existsSync('.git') && existsSync('scripts/git-hooks/pre-commit')) {
    execFileSync('git', ['config', 'core.hooksPath', 'scripts/git-hooks']);
    execFileSync('chmod', ['+x', 'scripts/git-hooks/pre-commit']);
  }
} catch {
  // Never fail an install over hook wiring.
}
