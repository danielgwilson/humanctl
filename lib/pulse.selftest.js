'use strict';

// Selftest for the pulse reconciler. Plain node, zero deps, no network, no
// real data: every fixture is synthetic but keeps the real-world SHAPES that
// broke naive designs, especially the branch-name shapes around one issue:
//   agent branch:   codex/build-592-x
//   bare branch:    build-592-y
//   Linear's slug:  feature/build-592-synthetic-title-slug (never equal to
//                   either; branchName equality is a rejected join)
// Run: npm run pulse:selftest

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  reconcile,
  summarizeChecks,
  parseWorktreePorcelain,
  parseUpstreamTrack,
  computeOpenNotes,
  headerLine,
  NEED_DECAY_MS,
} = require('./pulse');
const { extractIssueKeys, readWorkRefs } = require('./sessions');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

const NOW = Date.parse('2026-01-15T18:00:00Z');
const H = 3.6e6;

// ---- fixture builders (synthetic paths, names, and titles only) ----

function emptyCollected(overrides = {}) {
  return {
    now: NOW,
    gitRepos: [],
    ghRepos: [],
    linear: { issues: [], degraded: null },
    sessions: { rows: [], degraded: null },
    notes: { notes: [], degraded: null },
    ...overrides,
  };
}

const CONFIG = {
  staleHours: 24,
  repos: [{ name: 'acme', path: '/home/dev/work/acme/main', github: 'example/acme' }],
  linear: { workspace: 'example', assignee: 'dev@example.com', teams: ['BUILD'], states: ['started'] },
};

function issue(identifier, extra = {}) {
  return {
    identifier,
    title: `Synthetic issue ${identifier}`,
    url: `https://linear.app/example/issue/${identifier}/synthetic-title-slug`,
    priority: 2,
    priorityLabel: 'High',
    stateName: 'In Progress',
    queryState: 'started',
    updatedAtMs: NOW - 2 * H,
    ...extra,
  };
}

function worktree(branch, extra = {}) {
  return {
    path: `/home/dev/work/acme/worktrees/${branch ? branch.replace(/\//g, '-') : 'detached'}`,
    head: 'abc1234def',
    branch,
    detached: !branch,
    locked: false,
    prunable: false,
    dirty: false,
    ahead: 0,
    behind: 0,
    upstreamGone: false,
    lastCommitMs: NOW - 2 * H,
    repo: 'acme',
    ...extra,
  };
}

function pr(number, headRefName, extra = {}) {
  return {
    number,
    title: `Synthetic PR ${number}`,
    body: '',
    headRefName,
    isDraft: false,
    reviewDecision: '',
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    updatedAt: new Date(NOW - 1 * H).toISOString(),
    url: `https://github.com/example/acme/pull/${number}`,
    ...extra,
  };
}

function session(id, cwd, extra = {}) {
  return {
    harness: 'claude-code',
    id,
    cwd,
    repo: cwd,
    title: 'synthetic session',
    customTitle: '',
    lastRole: 'user',
    ageMs: NOW - 1 * H,
    age: '1h',
    sizeBytes: 1024,
    path: `/home/dev/.claude/projects/synthetic/${id}.jsonl`,
    inScope: true,
    ancestorScope: false,
    issueKeys: [],
    workRefs: { roots: [], tokens: [] },
    ...extra,
  };
}

function allLaneItems(result) {
  return Object.values(result.lanes).flat();
}

function laneOf(result, id) {
  for (const [key, items] of Object.entries(result.lanes)) {
    if (items.some((i) => i.id === id)) return key;
  }
  return null;
}

// ---- extractor: the one join key ----

check('extractIssueKeys joins all real-fleet branch shapes to one token', () => {
  assert.deepStrictEqual(extractIssueKeys('codex/build-592-x'), ['BUILD-592']);
  assert.deepStrictEqual(extractIssueKeys('build-592-y'), ['BUILD-592']);
  assert.deepStrictEqual(extractIssueKeys('feature/build-592-synthetic-title-slug'), ['BUILD-592']);
  assert.deepStrictEqual(extractIssueKeys('Fixes BUILD-592 and build-593'), ['BUILD-592', 'BUILD-593']);
  assert.deepStrictEqual(extractIssueKeys('https://linear.app/example/issue/BUILD-592/slug'), ['BUILD-592']);
});

check('extractIssueKeys rejects non-key shapes', () => {
  assert.deepStrictEqual(extractIssueKeys('a-1'), []); // single-letter prefix
  assert.deepStrictEqual(extractIssueKeys('2026-01-15'), []); // dates
  assert.deepStrictEqual(extractIssueKeys('agent-a064e668e1dffafe8'), []); // hex worktree names
  assert.deepStrictEqual(extractIssueKeys(''), []);
  assert.deepStrictEqual(extractIssueKeys(null), []);
});

// ---- the canonical join: four sources, one unit ----

check('issue + agent branch + PR + session reconcile into one unit via the token', () => {
  const collected = emptyCollected({
    gitRepos: [{
      name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null,
      worktrees: [worktree('codex/build-592-x')],
    }],
    ghRepos: [{
      name: 'acme', degraded: null, merged: [],
      open: [pr(41, 'build-592-y', { title: 'Synthetic change for build-592' })],
    }],
    linear: { issues: [issue('BUILD-592')], degraded: null },
    sessions: { rows: [session('s-1', '/home/dev/work/acme/worktrees/codex-build-592-x', { issueKeys: ['BUILD-592'] })], degraded: null },
  });
  const result = reconcile(collected, CONFIG);
  const items = allLaneItems(result);
  const unit = items.find((i) => i.id === 'BUILD-592');
  assert.ok(unit, 'expected a BUILD-592 unit');
  assert.strictEqual(items.filter((i) => i.workRef && i.workRef.issueKey === 'BUILD-592').length, 1, 'exactly one unit for the issue');
  assert.strictEqual(unit.workRef.provider, 'linear');
  assert.strictEqual(unit.executionRef.branch, 'codex/build-592-x');
  assert.strictEqual(unit.proofRef.prNumber, 41);
  assert.strictEqual(unit.executionRef.sessions.length, 1);
  assert.strictEqual(unit.confidence, 'explicit');
  // open PR, checks passing, not approved: the human owns the next move
  assert.strictEqual(laneOf(result, 'BUILD-592'), 'readyForReview');
});

check('no unit id ever appears in two lanes (double-count audit)', () => {
  const collected = emptyCollected({
    gitRepos: [{
      name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null,
      worktrees: [
        worktree('codex/build-592-x'),
        worktree('codex/build-593-z', { lastCommitMs: NOW - 60 * H }),
        worktree('experiment-spike', { dirty: true }),
      ],
    }],
    ghRepos: [{
      name: 'acme', degraded: null, merged: [],
      open: [pr(41, 'build-592-y'), pr(42, 'codex/build-594-w', { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })],
    }],
    linear: { issues: [issue('BUILD-592'), issue('BUILD-593'), issue('BUILD-595')], degraded: null },
    sessions: { rows: [session('s-1', '/home/dev/work/acme/worktrees/codex-build-592-x', { issueKeys: ['BUILD-592'] })], degraded: null },
  });
  const result = reconcile(collected, CONFIG);
  const ids = allLaneItems(result).map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length, `duplicate unit across lanes: ${ids.join(', ')}`);
});

// ---- lanes ----

check('blocked note surfaces at the top of needs-you with its session join', () => {
  const collected = emptyCollected({
    sessions: { rows: [session('s-9', '/home/dev/work/acme/main', { issueKeys: ['BUILD-592'] })], degraded: null },
    linear: { issues: [issue('BUILD-592')], degraded: null },
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [worktree('codex/build-592-x')] }],
    notes: {
      degraded: null,
      notes: [{ id: 'note_synth1', ts: new Date(NOW - 1 * H).toISOString(), level: 'blocked', message: 'Product call needed on synthetic thing', cwd: '/home/dev/work/acme/main', session: 's-9' }],
    },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'BUILD-592'), 'needsYou');
  assert.match(result.lanes.needsYou[0].next.action, /blocked note/);
});

check('open unattached blocked note still mints a needs-you unit', () => {
  const collected = emptyCollected({
    notes: {
      degraded: null,
      notes: [{ id: 'note_synth2', ts: new Date(NOW - 1 * H).toISOString(), level: 'blocked', message: 'Standalone escalation', cwd: '/home/dev/elsewhere', session: '' }],
    },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(result.lanes.needsYou.length, 1);
  assert.strictEqual(result.lanes.needsYou[0].id, 'note:note_synth2');
});

check('needs-you session decays after the imported desktop window', () => {
  const fresh = session('s-2', '/home/dev/work/acme/worktrees/codex-build-592-x', { lastRole: 'assistant', ageMs: NOW - NEED_DECAY_MS + 60000, issueKeys: ['BUILD-592'] });
  const old = session('s-3', '/home/dev/work/acme/worktrees/codex-build-593-z', { lastRole: 'assistant', ageMs: NOW - NEED_DECAY_MS - 60000, issueKeys: ['BUILD-593'] });
  const collected = emptyCollected({
    linear: { issues: [issue('BUILD-592'), issue('BUILD-593')], degraded: null },
    gitRepos: [{
      name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null,
      worktrees: [worktree('codex/build-592-x', { lastCommitMs: NOW - 30 * H }), worktree('codex/build-593-z', { lastCommitMs: NOW - 30 * H })],
    }],
    sessions: { rows: [fresh, old], degraded: null },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'BUILD-592'), 'needsYou');
  assert.notStrictEqual(laneOf(result, 'BUILD-593'), 'needsYou');
});

check('failing checks land in blocked-on-agent', () => {
  const collected = emptyCollected({
    ghRepos: [{ name: 'acme', degraded: null, merged: [], open: [pr(42, 'codex/build-594-w', { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })] }],
    linear: { issues: [issue('BUILD-594')], degraded: null },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'BUILD-594'), 'blockedOnAgent');
});

check('worktree whose PR merged is stale with a cleanup next', () => {
  const collected = emptyCollected({
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [worktree('codex/build-596-done')] }],
    ghRepos: [{
      name: 'acme', degraded: null, open: [],
      merged: [{ number: 40, title: 'Synthetic merged change', headRefName: 'codex/build-596-done', updatedAt: new Date(NOW - 5 * H).toISOString(), mergedAt: new Date(NOW - 5 * H).toISOString(), url: 'https://github.com/example/acme/pull/40' }],
    }],
    linear: { issues: [], degraded: null },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'BUILD-596'), 'stale');
  const item = result.lanes.stale.find((i) => i.id === 'BUILD-596');
  assert.match(item.next.action, /merged: remove the worktree/);
  assert.ok(item.next.ref.includes('worktrees'));
});

check('no movement past staleHours lands in stale', () => {
  const collected = emptyCollected({
    linear: { issues: [issue('BUILD-597')], degraded: null },
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [worktree('codex/build-597-q', { lastCommitMs: NOW - 50 * H })] }],
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'BUILD-597'), 'stale');
});

check('missing-owner both ways: keyless local work, and issue with no execution', () => {
  const collected = emptyCollected({
    linear: { issues: [issue('BUILD-598')], degraded: null },
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [worktree('experiment-spike', { dirty: true })] }],
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'local:acme:experiment-spike'), 'missingOwner');
  assert.strictEqual(laneOf(result, 'BUILD-598'), 'missingOwner');
});

check('fresh issue + execution + proof is verified', () => {
  const collected = emptyCollected({
    linear: { issues: [issue('BUILD-599')], degraded: null },
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [worktree('codex/build-599-v')] }],
    ghRepos: [{ name: 'acme', degraded: null, merged: [], open: [pr(43, 'codex/build-599-v', { isDraft: true })] }],
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'BUILD-599'), 'verified');
});

check('date-shaped tokens never mint work units from branch names', () => {
  const collected = emptyCollected({
    gitRepos: [{
      name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null,
      worktrees: [worktree('docs-rollup-2026-05-22', { dirty: true })],
    }],
  });
  const result = reconcile(collected, CONFIG);
  const ids = allLaneItems(result).map((i) => i.id);
  assert.ok(!ids.includes('ROLLUP-2026'), 'date-shaped token minted a unit');
  assert.ok(ids.includes('local:acme:docs-rollup-2026-05-22'), 'worktree fell back to a local cluster unit');
});

check('PR title/body tokens join existing units but never mint new ones', () => {
  const collected = emptyCollected({
    linear: { issues: [issue('BUILD-592')], degraded: null },
    ghRepos: [{
      name: 'acme', degraded: null, merged: [],
      open: [
        pr(50, 'misc-cleanup', { title: 'Follow-up for BUILD-592', body: 'closes BUILD-592' }),
        pr(51, 'other-fix', { title: 'Notes from October-2025 sync about AM-09', body: '' }),
      ],
    }],
  });
  const result = reconcile(collected, CONFIG);
  const ids = allLaneItems(result).map((i) => i.id);
  assert.ok(!ids.includes('AM-09'), 'free-text token minted a unit');
  assert.ok(!ids.includes('OCTOBER-2025'), 'date token minted a unit');
  assert.ok(ids.includes('pr:acme#51'), 'uncorroborated PR fell back to a pr-only unit');
  const joined = allLaneItems(result).find((i) => i.id === 'BUILD-592');
  assert.ok(joined && joined.proofRef && joined.proofRef.prNumber === 50, 'corroborated title token joined the issue unit');
});

check('a bare token unit carries no fabricated workRef', () => {
  const collected = emptyCollected({
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [worktree('codex/build-777-u', { dirty: true })] }],
  });
  const result = reconcile(collected, CONFIG);
  const item = allLaneItems(result).find((i) => i.id === 'BUILD-777');
  assert.ok(item, 'token still names the unit');
  assert.strictEqual(item.workRef, null, 'workRef must be null until the tracker confirms the issue');
});

// ---- degradation honesty ----

check('degraded linear keeps local lanes intact and marks every item', () => {
  const collected = emptyCollected({
    linear: { issues: null, degraded: 'linear not found on PATH' },
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [worktree('codex/build-592-x', { dirty: true })] }],
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(result.degraded.linear, 'linear not found on PATH');
  const item = allLaneItems(result).find((i) => i.id === 'BUILD-592');
  assert.ok(item, 'keyed unit still present under degraded linear');
  assert.ok(item.degraded.includes('linear'), 'item carries the degraded marker');
  // Blind on issues: a keyed unit must NOT be misfiled as missing-owner.
  assert.notStrictEqual(laneOf(result, 'BUILD-592'), 'missingOwner');
});

check('degraded gh marks items in that repo', () => {
  const collected = emptyCollected({
    linear: { issues: [issue('BUILD-592')], degraded: null },
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [worktree('codex/build-592-x')] }],
    ghRepos: [{ name: 'acme', open: null, merged: null, degraded: 'acme: gh pr list failed (gh not found on PATH)' }],
  });
  const result = reconcile(collected, CONFIG);
  assert.ok(result.degraded.gh);
  const item = allLaneItems(result).find((i) => i.id === 'BUILD-592');
  assert.ok(item.degraded.includes('gh'));
});

check('header line always names every lane and flags degradation', () => {
  const collected = emptyCollected({ linear: { issues: null, degraded: 'nope' } });
  const result = reconcile(collected, CONFIG);
  const line = headerLine(result.lanes, result.degraded);
  assert.match(line, /^pulse: \d+ needs? you, \d+ ready for review, \d+ blocked on agent, \d+ stale, \d+ unowned, \d+ verified \(degraded: linear\)$/);
});

// ---- the evidence scanner (synthetic transcript in a temp file) ----

check('readWorkRefs finds only vocabulary paths and tokens in the tail', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-selftest-')), 'synthetic.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ message: { role: 'user', content: 'work in /home/dev/work/acme/worktrees/codex-build-592-x/src/index.js please' } }),
    JSON.stringify({ message: { role: 'assistant', content: 'ran git -C /home/dev/work/acme/main status, branch experiment-spike is dirty, /home/dev/elsewhere/thing untouched' } }),
  ].join('\n'), 'utf8');
  const refs = readWorkRefs(file, {
    roots: ['/home/dev/work/acme/main', '/home/dev/work/acme/worktrees/codex-build-592-x'],
    tokens: ['experiment-spike', 'codex/build-777-u'],
  });
  assert.deepStrictEqual(refs.roots.sort(), ['/home/dev/work/acme/main', '/home/dev/work/acme/worktrees/codex-build-592-x']);
  assert.deepStrictEqual(refs.tokens, ['experiment-spike']);
  const empty = readWorkRefs(file, { roots: ['/home/dev/other'], tokens: [] });
  assert.deepStrictEqual(empty, { roots: [], tokens: [] });
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

// ---- session joining: parent-cwd launches and transcript evidence ----

// The primary checkout as git reports it: the repo path itself, clean, on main.
function primaryWorktree(extra = {}) {
  return worktree('main', { path: '/home/dev/work/acme/main', isPrimary: true, dirty: false, ahead: 0, ...extra });
}

check('parent-cwd session joins a worktree unit via transcript path evidence', () => {
  const collected = emptyCollected({
    linear: { issues: [issue('BUILD-592')], degraded: null },
    gitRepos: [{
      name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null,
      worktrees: [primaryWorktree(), worktree('codex/build-592-x', { lastCommitMs: NOW - 50 * H })],
    }],
    sessions: {
      degraded: null,
      rows: [session('s-40', '/home/dev/work', {
        inScope: false,
        ancestorScope: true,
        workRefs: { roots: ['/home/dev/work/acme/worktrees/codex-build-592-x'], tokens: [] },
      })],
    },
  });
  const result = reconcile(collected, CONFIG);
  const unit = allLaneItems(result).find((i) => i.id === 'BUILD-592');
  assert.ok(unit, 'expected the BUILD-592 unit');
  assert.strictEqual(unit.executionRef.sessions.length, 1, 'evidence join attached the session');
  assert.strictEqual(unit.executionRef.sessions[0].id, 's-40');
  // The joined session was active 1h ago: the 50h-old commit no longer bins it stale.
  assert.notStrictEqual(laneOf(result, 'BUILD-592'), 'stale');
});

check('parent-cwd session joins a keyless worktree unit via branch-token evidence', () => {
  const collected = emptyCollected({
    gitRepos: [{
      name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null,
      worktrees: [primaryWorktree(), worktree('experiment-spike', { dirty: true })],
    }],
    sessions: {
      degraded: null,
      rows: [session('s-41', '/home/dev/work', {
        inScope: false,
        ancestorScope: true,
        workRefs: { roots: [], tokens: ['experiment-spike'] },
      })],
    },
  });
  const result = reconcile(collected, CONFIG);
  const unit = allLaneItems(result).find((i) => i.id === 'local:acme:experiment-spike');
  assert.ok(unit && unit.executionRef.sessions.length === 1, 'branch token joined the session to the worktree unit');
  assert.strictEqual(unit.confidence, 'inferred');
});

check('fresh needs-you session with repo evidence but no unit mints a needs-you item', () => {
  const collected = emptyCollected({
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [primaryWorktree()] }],
    sessions: {
      degraded: null,
      rows: [session('s-42', '/home/dev/work', {
        inScope: false,
        ancestorScope: true,
        lastRole: 'assistant',
        workRefs: { roots: ['/home/dev/work/acme/main'], tokens: [] },
      })],
    },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'session:acme:s-42'), 'needsYou');
  const item = result.lanes.needsYou.find((i) => i.id === 'session:acme:s-42');
  assert.strictEqual(item.executionRef.repo, 'acme');
  assert.match(item.next.action, /respond to the waiting session/);
  assert.strictEqual(item.confidence, 'inferred');
});

check('fresh working session with repo evidence but no unit mints missing-owner, not needs-you', () => {
  const collected = emptyCollected({
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [primaryWorktree()] }],
    sessions: {
      degraded: null,
      rows: [session('s-43', '/home/dev/work/acme/main', { inScope: true, lastRole: 'user' })],
    },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'session:acme:s-43'), 'missingOwner');
});

check('ancestor cwd alone never joins: sibling work stays out of scope', () => {
  const collected = emptyCollected({
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [primaryWorktree()] }],
    sessions: {
      degraded: null,
      rows: [session('s-44', '/home/dev/work', {
        inScope: false,
        ancestorScope: true,
        lastRole: 'assistant',
        workRefs: { roots: [], tokens: [] },
      })],
    },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(allLaneItems(result).filter((i) => i.id.startsWith('session:')).length, 0, 'no session unit minted without evidence');
  const outOfScope = result.diagnostics.find((d) => d.type === 'sessions-out-of-scope');
  assert.ok(outOfScope && outOfScope.count === 1);
});

// ---- reader-state consumption (needs-you v3 rows) ----

check('reader state need mints needs-you even past the decay window', () => {
  const collected = emptyCollected({
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [primaryWorktree()] }],
    sessions: {
      degraded: null,
      rows: [session('s-50', '/home/dev/work', {
        inScope: false,
        ancestorScope: true,
        lastRole: 'assistant',
        state: 'need',
        tier: 'drifting',
        ageMs: NOW - 72 * H,
        lastActiveMs: NOW - 48 * H,
        workRefs: { roots: ['/home/dev/work/acme/main'], tokens: [] },
      })],
    },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'session:acme:s-50'), 'needsYou');
});

check('reader state done or archived never mints a session unit', () => {
  const mk = (id, extra) => session(id, '/home/dev/work', {
    inScope: false,
    ancestorScope: true,
    lastRole: 'assistant',
    workRefs: { roots: ['/home/dev/work/acme/main'], tokens: [] },
    ...extra,
  });
  const collected = emptyCollected({
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [primaryWorktree()] }],
    sessions: {
      degraded: null,
      rows: [
        mk('s-51', { state: 'done', tier: 'hot' }),
        // mtime-corrupted zombie: file touched (fresh ageMs) but the reader
        // read the tail and says idle/archived; must not mint needs-you.
        mk('s-52', { state: 'idle', tier: 'archived', lastActiveMs: NOW - 40 * 24 * H }),
      ],
    },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(allLaneItems(result).filter((i) => i.id.startsWith('session:')).length, 0, 'no session units minted');
  const unattached = result.diagnostics.find((d) => d.type === 'unattached-sessions');
  assert.ok(unattached && unattached.sessions === 2, 'both sessions counted in diagnostics');
});

check('session activity uses lastActiveMs, not corrupted file mtime', () => {
  // Worktree commit is 50h old; the joined session file mtime says 1h ago but
  // its last substantive event was 50h ago. The unit must read stale.
  const collected = emptyCollected({
    linear: { issues: [issue('BUILD-597')], degraded: null },
    gitRepos: [{
      name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null,
      worktrees: [worktree('codex/build-597-q', { lastCommitMs: NOW - 50 * H })],
    }],
    sessions: {
      degraded: null,
      rows: [session('s-53', '/home/dev/work/acme/worktrees/codex-build-597-q', {
        title: 'work on build-597 fixtures',
        lastRole: 'assistant',
        state: 'idle',
        tier: 'drifting',
        ageMs: NOW - 1 * H,
        lastActiveMs: NOW - 50 * H,
      })],
    },
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'BUILD-597'), 'stale');
});

// ---- staleness: activity, not just commit age ----

check('uncommitted edits keep a worktree out of stale', () => {
  const collected = emptyCollected({
    linear: { issues: [issue('BUILD-597')], degraded: null },
    gitRepos: [{
      name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null,
      worktrees: [worktree('codex/build-597-q', { lastCommitMs: NOW - 50 * H, lastEditMs: NOW - 2 * H, dirty: true })],
    }],
  });
  const result = reconcile(collected, CONFIG);
  assert.notStrictEqual(laneOf(result, 'BUILD-597'), 'stale');
});

check('old edits do not rescue an old commit from stale', () => {
  const collected = emptyCollected({
    linear: { issues: [issue('BUILD-597')], degraded: null },
    gitRepos: [{
      name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null,
      worktrees: [worktree('codex/build-597-q', { lastCommitMs: NOW - 60 * H, lastEditMs: NOW - 50 * H })],
    }],
  });
  const result = reconcile(collected, CONFIG);
  assert.strictEqual(laneOf(result, 'BUILD-597'), 'stale');
});

// ---- diagnostics: nothing silently dropped ----

check('decayed unattached and out-of-scope sessions land in diagnostics', () => {
  const collected = emptyCollected({
    gitRepos: [{ name: 'acme', github: 'example/acme', path: '/home/dev/work/acme/main', degraded: null, worktrees: [primaryWorktree()] }],
    sessions: {
      degraded: null,
      rows: [
        session('s-5', '/home/dev/work/acme/main', { inScope: true, lastRole: 'assistant', ageMs: NOW - NEED_DECAY_MS - 1 * H }),
        session('s-6', '/home/dev/unrelated', { inScope: false }),
      ],
    },
  });
  const result = reconcile(collected, CONFIG);
  const unattached = result.diagnostics.find((d) => d.type === 'unattached-sessions');
  const outOfScope = result.diagnostics.find((d) => d.type === 'sessions-out-of-scope');
  assert.ok(unattached && unattached.sessions === 1, 'decayed in-repo session counted, not laned');
  assert.ok(outOfScope && outOfScope.count === 1);
});

// ---- helpers ----

check('summarizeChecks covers the rollup verdicts', () => {
  assert.strictEqual(summarizeChecks(null), 'none');
  assert.strictEqual(summarizeChecks([]), 'none');
  assert.strictEqual(summarizeChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }]), 'passing');
  assert.strictEqual(summarizeChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: '' }]), 'pending');
  assert.strictEqual(summarizeChecks([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'failing');
  assert.strictEqual(summarizeChecks([{ state: 'ERROR' }]), 'failing');
});

check('parseWorktreePorcelain handles branch, detached, locked, prunable', () => {
  const text = [
    'worktree /home/dev/work/acme/main',
    'HEAD abc1234def',
    'branch refs/heads/main',
    '',
    'worktree /home/dev/work/acme/.claude/worktrees/agent-a0f1',
    'HEAD def5678abc',
    'branch refs/heads/codex/build-592-x',
    'locked',
    '',
    'worktree /tmp/acme-detached-test',
    'HEAD 9a06823aa',
    'detached',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\n');
  const wts = parseWorktreePorcelain(text);
  assert.strictEqual(wts.length, 3);
  assert.strictEqual(wts[0].branch, 'main');
  assert.strictEqual(wts[1].branch, 'codex/build-592-x');
  assert.strictEqual(wts[1].locked, true);
  assert.strictEqual(wts[2].detached, true);
  assert.strictEqual(wts[2].prunable, true);
});

check('parseUpstreamTrack reads ahead/behind/gone', () => {
  assert.deepStrictEqual(parseUpstreamTrack(''), { ahead: 0, behind: 0, gone: false });
  assert.deepStrictEqual(parseUpstreamTrack('[ahead 3]'), { ahead: 3, behind: 0, gone: false });
  assert.deepStrictEqual(parseUpstreamTrack('[ahead 1, behind 2]'), { ahead: 1, behind: 2, gone: false });
  assert.deepStrictEqual(parseUpstreamTrack('[gone]'), { ahead: null, behind: null, gone: true });
});

check('computeOpenNotes: done closes the session, decay window applies', () => {
  const notes = [
    { id: 'n1', ts: new Date(NOW - 1 * H).toISOString(), level: 'blocked', message: 'open one', session: 'sA', cwd: '/w' },
    { id: 'n2', ts: new Date(NOW - 2 * H).toISOString(), level: 'review', message: 'closed by done', session: 'sB', cwd: '/w' },
    { id: 'n3', ts: new Date(NOW - 1 * H).toISOString(), level: 'done', message: 'wrapped', session: 'sB', cwd: '/w' },
    { id: 'n4', ts: new Date(NOW - NEED_DECAY_MS - 1 * H).toISOString(), level: 'blocked', message: 'decayed', session: 'sC', cwd: '/w' },
    { id: 'n5', ts: new Date(NOW - 1 * H).toISOString(), level: 'fyi', message: 'not an escalation', session: 'sD', cwd: '/w' },
  ];
  const open = computeOpenNotes(notes, NOW);
  assert.deepStrictEqual(open.map((n) => n.id), ['n1']);
});

// ---- verdict ----

if (process.exitCode) {
  console.error(`pulse selftest: FAILED (${passed} passed before failure)`);
} else {
  console.log(`pulse selftest: ok (${passed} checks)`);
}
