'use strict';

// humanctl pulse: read-only reconciliation of four sources of truth (Linear
// issues, local git worktrees, GitHub PRs + checks, agent sessions) plus the
// notes inbox into one answer: what is true, who owns the next move, and what
// needs the human. Mutates nothing. Trust is the product.
//
// Honesty rules (non-negotiable, see docs/pulse.md):
// - Exit codes are untrusted. The linear CLI exits 0 on unknown options, auth
//   failures, and help dumps. Every adapter validates output SHAPE and sets
//   degraded.<source> with a reason on any mismatch.
// - A degraded source never renders as an empty success: affected data is
//   null and every lane item computed under a degraded source carries a
//   visible degraded marker.
// - Worktrees come from `git worktree list --porcelain`, never from config.
// - The one join key across sources is the issue-key token (TEAM-123),
//   extracted by lib/sessions.js extractIssueKeys. Linear branchName equality
//   is explicitly rejected: Linear generates feature/team-123-title-slug and
//   real branches never match it.
// - Each reconciled unit lands in exactly one lane (first match in priority
//   order). Units matching no lane go to diagnostics, never dropped.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const sessionsLib = require('./sessions');

const SUBPROCESS_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 120 * 1000;
const DEFAULT_STALE_HOURS = 24;

// The desktop's needs-you decay: an assistant-last session is only "waiting on
// you" inside this window, then it is history, not a queue item. Imported from
// the session reader when present so the two surfaces never fork the
// threshold; the fallback matches the desktop value (18h, docs/desktop.md).
const NEED_DECAY_MS = sessionsLib.NEED_DECAY_MS || 18 * 60 * 60 * 1000;

const LANE_KEYS = ['needsYou', 'readyForReview', 'blockedOnAgent', 'stale', 'missingOwner', 'verified'];
const LANE_LABELS = {
  needsYou: 'needs-you',
  readyForReview: 'ready-for-review',
  blockedOnAgent: 'blocked-on-agent',
  stale: 'stale',
  missingOwner: 'missing-owner',
  verified: 'verified',
};

function globalDir() {
  return path.join(os.homedir(), '.humanctl');
}

function expandHome(p) {
  if (!p) return p;
  return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

// ---- config -----------------------------------------------------------------

function loadConfig(configPath) {
  const file = configPath || path.join(globalDir(), 'pulse.json');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch {
    return { config: null, error: `no config at ${file}; see docs/pulse.md for the schema` };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    return { config: null, error: `config at ${file} is not valid JSON: ${e.message}` };
  }
  const repos = Array.isArray(parsed.repos)
    ? parsed.repos
        .filter((r) => r && r.name && r.path)
        .map((r) => ({ name: String(r.name), path: expandHome(String(r.path)), github: r.github ? String(r.github) : null }))
    : [];
  const linear = parsed.linear && typeof parsed.linear === 'object'
    ? {
        workspace: parsed.linear.workspace ? String(parsed.linear.workspace) : null,
        assignee: parsed.linear.assignee ? String(parsed.linear.assignee) : null,
        teams: Array.isArray(parsed.linear.teams) ? parsed.linear.teams.map(String) : [],
        states: Array.isArray(parsed.linear.states) && parsed.linear.states.length
          ? parsed.linear.states.map(String)
          : ['started'],
      }
    : null;
  const staleHours = Number.isFinite(parsed.staleHours) && parsed.staleHours > 0 ? parsed.staleHours : DEFAULT_STALE_HOURS;
  return { config: { staleHours, repos, linear }, error: null };
}

// ---- subprocess helper --------------------------------------------------------

// Never rejects. ok:false carries a short human-readable reason. Callers must
// still shape-validate stdout even when ok:true: exit codes are untrusted.
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs || SUBPROCESS_TIMEOUT_MS, maxBuffer: 16 << 20, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          let reason;
          if (error.code === 'ENOENT') reason = `${cmd} not found on PATH`;
          else if (error.killed || error.signal === 'SIGTERM') reason = `${cmd} timed out after ${Math.round((opts.timeoutMs || SUBPROCESS_TIMEOUT_MS) / 1000)}s`;
          else reason = String(stderr || error.message || 'failed').trim().replace(/\s+/g, ' ').slice(0, 200);
          resolve({ ok: false, stdout: String(stdout || ''), reason });
          return;
        }
        resolve({ ok: true, stdout: String(stdout || ''), reason: null });
      }
    );
  });
}

// Tiny bounded-concurrency map; zero deps.
function mapLimit(items, limit, fn) {
  return new Promise((resolve) => {
    const results = new Array(items.length);
    let next = 0;
    let active = 0;
    const step = () => {
      if (next >= items.length && active === 0) { resolve(results); return; }
      while (active < limit && next < items.length) {
        const i = next;
        next += 1;
        active += 1;
        Promise.resolve()
          .then(() => fn(items[i], i))
          .then((r) => { results[i] = r; }, () => { results[i] = undefined; })
          .then(() => { active -= 1; step(); });
      }
    };
    step();
  });
}

// ---- git adapter ---------------------------------------------------------------

function parseWorktreePorcelain(text) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), head: null, branch: null, detached: false, locked: false, prunable: false, bare: false };
      out.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'locked' || line.startsWith('locked ')) cur.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) cur.prunable = true;
    else if (line === 'bare') cur.bare = true;
  }
  return out;
}

function parseUpstreamTrack(track) {
  if (!track) return { ahead: 0, behind: 0, gone: false };
  if (track === '[gone]') return { ahead: null, behind: null, gone: true };
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, gone: false };
}

async function collectGitRepo(repo, staleHours, now) {
  const wtRes = await run('git', ['-C', repo.path, 'worktree', 'list', '--porcelain']);
  if (!wtRes.ok) {
    return { name: repo.name, github: repo.github, path: repo.path, worktrees: null, degraded: `${repo.name}: git worktree list failed (${wtRes.reason})` };
  }
  const worktrees = parseWorktreePorcelain(wtRes.stdout).filter((w) => !w.bare && !w.prunable);
  if (worktrees.length) worktrees[0].isPrimary = true; // git lists the main checkout first

  // One for-each-ref per repo covers last-commit age and ahead/behind for every
  // local branch, instead of two extra subprocesses per worktree.
  const refRes = await run('git', ['-C', repo.path, 'for-each-ref', 'refs/heads', '--format=%(refname:short)%09%(committerdate:unix)%09%(upstream:track)']);
  const branchInfo = {};
  if (refRes.ok) {
    for (const line of refRes.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [name, date, track] = line.split('\t');
      if (!name) continue;
      branchInfo[name] = { lastCommitMs: date ? Number(date) * 1000 : null, ...parseUpstreamTrack(track || '') };
    }
  }

  // Real fleets carry hundreds of long-dead agent worktrees; running `git
  // status` in each would dominate the run. A worktree whose branch tip is far
  // past the stale window is stale by no-movement regardless of its tree
  // state, so the dirty check is skipped there and reported as null (unknown),
  // never fabricated. Primaries always get the check: a dirty main checkout is
  // one of the signals pulse exists to surface.
  const statusWindowMs = staleHours * 4 * 3.6e6;
  await mapLimit(worktrees, 12, async (w) => {
    w.repo = repo.name;
    const info = w.branch ? branchInfo[w.branch] : null;
    if (info) {
      w.lastCommitMs = info.lastCommitMs;
      w.ahead = info.ahead;
      w.behind = info.behind;
      w.upstreamGone = info.gone;
    } else {
      const lg = await run('git', ['-C', w.path, 'log', '-1', '--format=%ct']);
      w.lastCommitMs = lg.ok && lg.stdout.trim() ? Number(lg.stdout.trim()) * 1000 : null;
      w.ahead = null;
      w.behind = null;
      w.upstreamGone = false;
    }
    const recent = w.lastCommitMs === null || now - w.lastCommitMs <= statusWindowMs;
    if (w.isPrimary || recent) {
      const st = await run('git', ['-C', w.path, 'status', '--porcelain', '--untracked-files=no']);
      w.dirty = st.ok ? st.stdout.trim().length > 0 : null;
    } else {
      w.dirty = null;
    }
  });

  return { name: repo.name, github: repo.github, path: repo.path, worktrees, degraded: null };
}

// ---- gh adapter ----------------------------------------------------------------

const GH_OPEN_FIELDS = 'number,title,body,headRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,url';
const GH_MERGED_FIELDS = 'number,title,headRefName,updatedAt,url,mergedAt';

function parsePrArray(stdout, label) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch {
    return { prs: null, reason: `${label}: gh output was not JSON (${stdout.trim().slice(0, 80) || 'empty'})` };
  }
  if (!Array.isArray(parsed)) return { prs: null, reason: `${label}: gh output was not an array` };
  return { prs: parsed, reason: null };
}

// Summarize a statusCheckRollup array: passing / failing / pending / none.
function summarizeChecks(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  let pending = false;
  for (const c of rollup) {
    const verdict = String(c.conclusion || c.state || '').toUpperCase();
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(verdict)) return 'failing';
    if (!verdict || ['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING'].includes(verdict)) pending = true;
  }
  return pending ? 'pending' : 'passing';
}

async function collectGhRepo(repo) {
  if (!repo.github) return { name: repo.name, open: null, merged: null, degraded: `${repo.name}: no github remote configured` };
  const [openRes, mergedRes] = await Promise.all([
    run('gh', ['pr', 'list', '-R', repo.github, '--state', 'open', '--limit', '50', '--json', GH_OPEN_FIELDS]),
    run('gh', ['pr', 'list', '-R', repo.github, '--state', 'merged', '--limit', '20', '--json', GH_MERGED_FIELDS]),
  ]);
  if (!openRes.ok) return { name: repo.name, open: null, merged: null, degraded: `${repo.name}: gh pr list failed (${openRes.reason})` };
  const open = parsePrArray(openRes.stdout, repo.name);
  if (open.reason) return { name: repo.name, open: null, merged: null, degraded: open.reason };
  let merged = { prs: [], reason: null };
  if (mergedRes.ok) merged = parsePrArray(mergedRes.stdout, repo.name);
  else merged = { prs: null, reason: `${repo.name}: gh merged list failed (${mergedRes.reason})` };
  // Merged PRs only power stale-worktree cleanup detection; a failure there
  // degrades the source (cleanup candidates would silently vanish otherwise).
  if (merged.reason) return { name: repo.name, open: open.prs, merged: null, degraded: merged.reason };
  return { name: repo.name, open: open.prs, merged: merged.prs, degraded: null };
}

// ---- linear adapter -------------------------------------------------------------

function normalizeIssue(node, queryState) {
  return {
    identifier: String(node.identifier || '').toUpperCase(),
    title: node.title || '',
    url: node.url || null,
    priority: node.priority != null ? node.priority : null,
    priorityLabel: node.priorityLabel || null,
    stateName: node.state && node.state.name ? node.state.name : null,
    queryState,
    updatedAtMs: node.updatedAt ? Date.parse(node.updatedAt) : null,
  };
}

async function collectLinearIssues(linearCfg) {
  if (!linearCfg || !linearCfg.teams.length) return { issues: null, degraded: 'not configured' };
  const calls = [];
  for (const team of linearCfg.teams) for (const state of linearCfg.states) calls.push({ team, state });
  const results = await mapLimit(calls, 4, async (c) => {
    const args = ['issue', 'query', '--team', c.team, '--state', c.state, '--json', '--no-pager'];
    if (linearCfg.workspace) args.push('--workspace', linearCfg.workspace);
    if (linearCfg.assignee) args.push('--assignee', linearCfg.assignee);
    const res = await run('linear', args);
    if (!res.ok) return { error: `linear query (${c.team}/${c.state}) failed: ${res.reason}` };
    // Shape validation is the real gate: linear v2 exits 0 on unknown options,
    // auth failures, and help dumps, so the exit code proves nothing.
    let parsed;
    try { parsed = JSON.parse(res.stdout); } catch {
      return { error: `linear output was not JSON (${c.team}/${c.state}): ${res.stdout.trim().replace(/\s+/g, ' ').slice(0, 80) || 'empty'}` };
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes)) {
      return { error: `linear output missing nodes array (${c.team}/${c.state})` };
    }
    return { nodes: parsed.nodes.map((n) => normalizeIssue(n, c.state)) };
  });
  const issues = [];
  const errors = [];
  for (const r of results) {
    if (!r || r.error) errors.push(r ? r.error : 'linear query failed');
    else issues.push(...r.nodes);
  }
  // All-or-nothing: partial issue truth would misfile units into missing-owner,
  // so any failed call degrades the whole source.
  if (errors.length) return { issues: null, degraded: errors.join('; ') };
  return { issues, degraded: null };
}

// ---- sessions adapter -----------------------------------------------------------

function cwdWithin(cwd, root) {
  if (!cwd || !root) return false;
  return cwd === root || cwd.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

function collectSessions(config, gitRepos) {
  const haveDirs = sessionsLib.HARNESSES.some((h) => fs.existsSync(h.dir));
  if (!haveDirs) return { rows: null, degraded: 'no session directories found (no Codex or Claude Code logs on this machine)' };
  let rows;
  try {
    rows = sessionsLib.listRecent({ maxAgeH: Math.max(72, config.staleHours * 2), limit: 200 });
  } catch (e) {
    return { rows: null, degraded: `session scan failed: ${e.message}` };
  }
  const roots = [];
  for (const repo of config.repos) roots.push(repo.path);
  for (const g of gitRepos) if (g.worktrees) for (const w of g.worktrees) roots.push(w.path);
  for (const r of rows) {
    r.inScope = roots.some((root) => cwdWithin(r.cwd, root));
    if (r.inScope) {
      // Bounded head+tail read: Linear URLs plus bare issue-key tokens.
      const refs = sessionsLib.readIssueRefs(r.path);
      r.issueKeys = refs.keys;
    } else {
      // Out-of-scope sessions get the cheap extraction only (title + cwd).
      r.issueKeys = sessionsLib.extractIssueKeys(`${r.title} ${r.customTitle} ${r.cwd}`);
    }
  }
  return { rows, degraded: null };
}

// ---- notes adapter --------------------------------------------------------------

function collectNotes() {
  if (!fs.existsSync(sessionsLib.NOTES_FILE)) return { notes: [], degraded: null }; // never posted a note: empty truth, not a failure
  try {
    return { notes: sessionsLib.readNotes({ limit: 200 }), degraded: null };
  } catch (e) {
    return { notes: null, degraded: `notes read failed: ${e.message}` };
  }
}

// ---- cache -----------------------------------------------------------------------

function cachePath() {
  return path.join(globalDir(), 'pulse-cache.json');
}

function cacheSignature(config) {
  return JSON.stringify({
    repos: config.repos.map((r) => `${r.name}:${r.github || ''}`),
    linear: config.linear ? { w: config.linear.workspace, t: config.linear.teams, s: config.linear.states, a: config.linear.assignee } : null,
  });
}

function readCache(config, now) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf8')); } catch { return {}; }
  if (!parsed || parsed.signature !== cacheSignature(config)) return {};
  const out = {};
  for (const source of ['gh', 'linear']) {
    const entry = parsed[source];
    if (entry && Number.isFinite(entry.at) && now - entry.at < CACHE_TTL_MS && entry.data !== undefined) out[source] = entry.data;
  }
  return out;
}

function writeCache(config, now, ghData, linearData) {
  const dir = globalDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return; }
  // Merge with still-valid entries so refreshing one source does not evict the
  // other mid-TTL.
  const record = { signature: cacheSignature(config) };
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(cachePath(), 'utf8')); } catch { existing = null; }
  if (existing && existing.signature === record.signature) {
    for (const source of ['gh', 'linear']) {
      const entry = existing[source];
      if (entry && Number.isFinite(entry.at) && now - entry.at < CACHE_TTL_MS) record[source] = entry;
    }
  }
  // Only successful collections are cached; a degraded fetch is retried on the
  // next run instead of pinning the failure for the TTL.
  if (ghData && ghData.every((r) => !r.degraded)) record.gh = { at: now, data: ghData };
  if (linearData && !linearData.degraded) record.linear = { at: now, data: linearData };
  const file = cachePath();
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(record)}\n`, 'utf8');
    fs.renameSync(tmp, file);
  } catch { /* cache is best-effort */ }
}

// ---- collection -------------------------------------------------------------------

async function collect(config, opts = {}) {
  const now = opts.now || Date.now();
  const cached = opts.fresh ? {} : readCache(config, now);

  const gitPromise = mapLimit(config.repos, 3, (repo) => collectGitRepo(repo, config.staleHours, now));
  const ghPromise = cached.gh ? Promise.resolve(cached.gh) : mapLimit(config.repos, 3, collectGhRepo);
  const linearPromise = cached.linear ? Promise.resolve(cached.linear) : collectLinearIssues(config.linear);
  const notes = collectNotes();

  const [gitRepos, ghRepos, linear] = await Promise.all([gitPromise, ghPromise, linearPromise]);
  const sessions = collectSessions(config, gitRepos); // needs worktree paths for cwd scoping

  if (!cached.gh || !cached.linear) writeCache(config, now, cached.gh ? null : ghRepos, cached.linear ? null : linear);

  return { now, gitRepos, ghRepos, linear, sessions, notes };
}

// ---- reconcile (pure over collected inputs) -----------------------------------------

function firstKey(text) {
  const keys = sessionsLib.extractIssueKeys(text);
  return keys.length ? keys[0] : null;
}

// The issue-key token is a regex over messy text, so date-shaped tokens slip
// through (OCTOBER-2025, SBOM-20260225 on the real fleet). A token whose
// number reads as a year or longer never mints a work unit on its own; it can
// still join when Linear knows it as a real issue identifier.
function dateLikeKey(key) {
  const num = key.slice(key.indexOf('-') + 1);
  return /^(19|20)\d{2}$/.test(num) || num.length >= 6;
}

function firstMintableKey(text, knownKeys) {
  for (const key of sessionsLib.extractIssueKeys(text)) {
    if (knownKeys.has(key) || !dateLikeKey(key)) return key;
  }
  return null;
}

function relAge(ms, now) {
  if (!Number.isFinite(ms)) return null;
  const h = (now - ms) / 3.6e6;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function makeUnit(id) {
  return {
    id,
    keyed: null,
    issue: null,
    worktrees: [],
    prs: [],
    mergedPrs: [],
    sessions: [],
    notes: [],
    repoNames: new Set(),
    joins: [], // 'explicit' | 'inferred'
  };
}

// A note is open while it is a blocked/review escalation, fresher than the
// needs-you decay window, and no later done note closed the same session (or
// the same cwd when the note carries no session id).
function computeOpenNotes(notes, now) {
  const open = [];
  const doneAfter = []; // {ts, session, cwd}
  const sorted = [...notes].sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0));
  for (const note of sorted) {
    const ts = Date.parse(note.ts || 0);
    if (!Number.isFinite(ts)) continue;
    if (note.level === 'done') { doneAfter.push({ ts, session: note.session || '', cwd: note.cwd || '' }); continue; }
    if (note.level !== 'blocked' && note.level !== 'review') continue;
    if (now - ts > NEED_DECAY_MS) continue;
    const closed = doneAfter.some((d) => d.ts >= ts && (note.session ? d.session === note.session : d.cwd && d.cwd === note.cwd));
    if (!closed) open.push({ ...note, tsMs: ts });
  }
  return open;
}

function reconcile(collected, config) {
  const now = collected.now;
  const staleMs = config.staleHours * 3.6e6;
  const unitsByKey = new Map();
  const units = [];
  const diagnostics = [];

  const degraded = {
    git: null,
    gh: null,
    linear: collected.linear.degraded,
    sessions: collected.sessions.degraded,
    notes: collected.notes.degraded,
  };
  const gitDegraded = collected.gitRepos.filter((r) => r.degraded).map((r) => r.degraded);
  if (gitDegraded.length) degraded.git = gitDegraded.join('; ');
  const ghDegraded = collected.ghRepos.filter((r) => r.degraded).map((r) => r.degraded);
  if (ghDegraded.length) degraded.gh = ghDegraded.join('; ');
  const ghDegradedRepos = new Set(collected.ghRepos.filter((r) => r.degraded).map((r) => r.name));

  const unitFor = (key) => {
    if (unitsByKey.has(key)) return unitsByKey.get(key);
    const u = makeUnit(key);
    u.keyed = key;
    unitsByKey.set(key, u);
    units.push(u);
    return u;
  };
  const localUnit = (id) => {
    const u = makeUnit(id);
    units.push(u);
    return u;
  };

  // 1) Work authority: one unit per Linear issue.
  const knownIssueKeys = new Set();
  if (collected.linear.issues) {
    for (const issue of collected.linear.issues) {
      if (!issue.identifier) continue;
      knownIssueKeys.add(issue.identifier);
      const u = unitFor(issue.identifier);
      u.issue = issue;
      u.joins.push('explicit');
    }
  }

  // 2) Execution: worktrees from git (never from config). The clean primary
  // checkout sitting on main with nothing unpushed is healthy baseline, not a
  // work unit; everything else is real local state worth reconciling.
  const unitByRepoBranch = new Map(); // `${repo}:${branch}` -> unit
  for (const repo of collected.gitRepos) {
    if (!repo.worktrees) continue;
    for (const w of repo.worktrees) {
      const onDefault = w.branch === 'main' || w.branch === 'master';
      if (w.isPrimary && onDefault && w.dirty === false && !(w.ahead > 0)) continue;
      const key = firstMintableKey(w.branch || '', knownIssueKeys) || firstMintableKey(path.basename(w.path), knownIssueKeys);
      let u;
      if (key) {
        u = unitFor(key);
        u.joins.push('explicit');
      } else {
        u = localUnit(`local:${repo.name}:${w.branch || `detached-${(w.head || '').slice(0, 7)}`}`);
        u.joins.push('inferred');
      }
      u.worktrees.push(w);
      u.repoNames.add(repo.name);
      if (w.branch) unitByRepoBranch.set(`${repo.name}:${w.branch}`, u);
    }
  }

  // 3) Proof: open PRs join by issue-key token, then by branch name against a
  // discovered worktree, else they mint their own unit. Only headRef tokens
  // mint new units (branch naming is the execution convention); title/body
  // tokens are free text, so they join existing units but never mint. This is
  // the same corroboration rule sessions get, and it is what keeps date-shaped
  // and prose tokens from fabricating work units.
  for (const repo of collected.ghRepos) {
    if (!repo.open) continue;
    for (const pr of repo.open) {
      pr.checks = summarizeChecks(pr.statusCheckRollup);
      pr.updatedAtMs = pr.updatedAt ? Date.parse(pr.updatedAt) : null;
      pr.repo = repo.name;
      const headKey = firstMintableKey(pr.headRefName || '', knownIssueKeys);
      const textKey = sessionsLib.extractIssueKeys(`${pr.title || ''} ${pr.body || ''}`).find((k) => unitsByKey.has(k)) || null;
      let u = null;
      if (headKey) { u = unitFor(headKey); u.joins.push('explicit'); }
      else if (textKey) { u = unitsByKey.get(textKey); u.joins.push('explicit'); }
      else if (unitByRepoBranch.has(`${repo.name}:${pr.headRefName}`)) { u = unitByRepoBranch.get(`${repo.name}:${pr.headRefName}`); u.joins.push('inferred'); }
      else { u = localUnit(`pr:${repo.name}#${pr.number}`); u.joins.push('explicit'); }
      u.prs.push(pr);
      u.repoNames.add(repo.name);
    }
    // Merged PRs do not mint units; they flag cleanup candidates on worktrees.
    if (repo.merged) {
      for (const pr of repo.merged) {
        pr.mergedAtMs = pr.mergedAt ? Date.parse(pr.mergedAt) : null;
        const byBranch = unitByRepoBranch.get(`${repo.name}:${pr.headRefName}`);
        const key = firstKey(`${pr.headRefName || ''} ${pr.title || ''}`);
        const byKey = key && unitsByKey.has(key) ? unitsByKey.get(key) : null;
        const u = byBranch || byKey;
        if (u && u.worktrees.some((w) => w.branch === pr.headRefName)) { u.mergedPrs.push({ ...pr, repo: repo.name }); u.repoNames.add(repo.name); }
      }
    }
  }

  // 4) Attempts: sessions join by corroborated issue key first (bare tokens are
  // noisy, so a transcript key only joins when linear/git/gh already know it),
  // then by cwd containment inside a discovered worktree.
  const unattachedByRepo = new Map();
  let outOfScope = 0;
  if (collected.sessions.rows) {
    for (const s of collected.sessions.rows) {
      const matched = (s.issueKeys || []).filter((k) => unitsByKey.has(k));
      if (matched.length) {
        for (const k of matched) {
          const u = unitsByKey.get(k);
          u.sessions.push(s);
          u.joins.push('explicit');
          if (s.inScope) for (const repo of collected.gitRepos) if (repo.worktrees && repo.worktrees.some((w) => cwdWithin(s.cwd, w.path))) u.repoNames.add(repo.name);
        }
        continue;
      }
      if (!s.inScope) { outOfScope += 1; continue; }
      // cwd containment: deepest worktree that contains the session cwd.
      let best = null;
      let bestRepo = null;
      for (const repo of collected.gitRepos) {
        if (!repo.worktrees) continue;
        for (const w of repo.worktrees) {
          if (cwdWithin(s.cwd, w.path) && (!best || w.path.length > best.path.length)) { best = w; bestRepo = repo.name; }
        }
      }
      const owner = best && units.find((u) => u.worktrees.includes(best));
      if (owner) {
        owner.sessions.push(s);
        owner.joins.push('inferred');
        owner.repoNames.add(bestRepo);
      } else {
        const repoName = bestRepo || (config.repos.find((r) => cwdWithin(s.cwd, r.path)) || {}).name || 'unknown';
        const cur = unattachedByRepo.get(repoName) || { sessions: 0, needsYou: 0 };
        cur.sessions += 1;
        if (s.lastRole === 'assistant' && now - s.ageMs <= NEED_DECAY_MS) cur.needsYou += 1;
        unattachedByRepo.set(repoName, cur);
      }
    }
  }

  // 5) Escalations: open blocked/review notes join by session, key, or cwd;
  // an open note that joins nothing still surfaces as its own needs-you unit.
  const openNotes = collected.notes.notes ? computeOpenNotes(collected.notes.notes, now) : [];
  for (const note of openNotes) {
    let target = null;
    if (note.session) target = units.find((u) => u.sessions.some((s) => s.id === note.session));
    if (!target) {
      const key = firstKey(note.message || '');
      if (key && unitsByKey.has(key)) target = unitsByKey.get(key);
    }
    if (!target && note.cwd) {
      target = units.find((u) => u.worktrees.some((w) => cwdWithin(note.cwd, w.path) || cwdWithin(w.path, note.cwd)));
    }
    if (!target) {
      target = localUnit(`note:${note.id}`);
      target.joins.push('explicit');
    }
    target.notes.push(note);
  }

  // ---- evidence and lanes ----
  const lanes = { needsYou: [], readyForReview: [], blockedOnAgent: [], stale: [], missingOwner: [], verified: [] };

  for (const u of units) {
    const activity = [];
    for (const w of u.worktrees) if (Number.isFinite(w.lastCommitMs)) activity.push(w.lastCommitMs);
    for (const p of u.prs) if (Number.isFinite(p.updatedAtMs)) activity.push(p.updatedAtMs);
    for (const s of u.sessions) if (Number.isFinite(s.ageMs)) activity.push(s.ageMs);
    for (const n of u.notes) if (Number.isFinite(n.tsMs)) activity.push(n.tsMs);
    const lastActivityMs = activity.length ? Math.max(...activity) : null;

    const openNote = u.notes.find((n) => n.level === 'blocked') || u.notes.find((n) => n.level === 'review') || null;
    // A needs-you session flips the lane only when nothing on the unit moved
    // after it: newer sibling activity means the ball already moved on.
    const needsYouSession = u.sessions.find((s) =>
      s.lastRole === 'assistant'
      && now - s.ageMs <= NEED_DECAY_MS
      && !activity.some((t) => t > s.ageMs)
    ) || null;

    const reviewablePr = u.prs.find((p) => !p.isDraft && (p.checks === 'passing' || p.checks === 'none') && p.reviewDecision !== 'APPROVED') || null;
    const failingPr = u.prs.find((p) => p.checks === 'failing') || null;
    const cleanupWt = u.mergedPrs.length ? u.worktrees.find((w) => u.mergedPrs.some((p) => p.headRefName === w.branch)) : null;

    const hasExecution = u.worktrees.length > 0 || u.sessions.length > 0;
    const hasProof = u.prs.length > 0 || u.mergedPrs.length > 0;
    const isFresh = lastActivityMs !== null && now - lastActivityMs <= staleMs;
    const issueKnown = !!u.issue;
    const linearBlind = !!degraded.linear;
    const ghBlind = [...u.repoNames].some((r) => ghDegradedRepos.has(r)) || (!!degraded.gh && u.repoNames.size === 0);

    const degradedSources = [];
    if (linearBlind) degradedSources.push('linear');
    if (ghBlind) degradedSources.push('gh');
    if (degraded.sessions) degradedSources.push('sessions');
    if (degraded.notes) degradedSources.push('notes');
    if (degraded.git && [...u.repoNames].some((r) => collected.gitRepos.some((g) => g.name === r && g.degraded))) degradedSources.push('git');

    let lane = null;
    let next = null;

    if (openNote || needsYouSession) {
      lane = 'needsYou';
      if (openNote) next = { action: `answer the ${openNote.level} note`, ref: openNote.cwd || (needsYouSession && needsYouSession.cwd) || null };
      else next = { action: 'respond to the waiting session', ref: needsYouSession.cwd || needsYouSession.path };
    } else if (reviewablePr) {
      lane = 'readyForReview';
      next = { action: `review PR #${reviewablePr.number}${reviewablePr.checks === 'none' ? ' (no checks configured)' : ''}`, ref: reviewablePr.url };
    } else if (failingPr) {
      lane = 'blockedOnAgent';
      next = { action: `checks failing on PR #${failingPr.number}: investigate or restart the agent`, ref: failingPr.url };
    } else if (cleanupWt) {
      lane = 'stale';
      const merged = u.mergedPrs.find((p) => p.headRefName === cleanupWt.branch);
      next = { action: `PR #${merged.number} merged: remove the worktree`, ref: cleanupWt.path };
    } else if ((hasExecution || hasProof) && !isFresh) {
      lane = 'stale';
      const ageH = lastActivityMs ? Math.round((now - lastActivityMs) / 3.6e6) : null;
      next = { action: `no movement for ${ageH !== null ? `${ageH}h` : 'longer than the window'}: nudge, reassign, or clean up`, ref: (u.issue && u.issue.url) || (u.worktrees[0] && u.worktrees[0].path) || (u.prs[0] && u.prs[0].url) || null };
    } else if (!issueKnown && !linearBlind && (hasExecution || hasProof)) {
      lane = 'missingOwner';
      next = { action: 'local work with no reconciled issue: link it to an issue or file one', ref: (u.worktrees[0] && u.worktrees[0].path) || (u.prs[0] && u.prs[0].url) || (u.sessions[0] && u.sessions[0].cwd) || null };
    } else if (issueKnown && !hasExecution && !hasProof && !degraded.sessions && !degraded.git) {
      lane = 'missingOwner';
      next = { action: 'started in the tracker but no local execution or PR found: delegate or start it', ref: u.issue.url };
    } else if ((issueKnown || linearBlind) && (hasExecution || hasProof) && isFresh) {
      lane = 'verified';
      next = null;
    }

    const item = {
      id: u.id,
      title: (u.issue && u.issue.title)
        || (u.prs[0] && u.prs[0].title)
        || (u.worktrees[0] && `${[...u.repoNames][0] || ''}:${u.worktrees[0].branch || path.basename(u.worktrees[0].path)}`)
        || (u.notes[0] && u.notes[0].message)
        || u.id,
      lane: lane ? LANE_LABELS[lane] : null,
      confidence: u.joins.includes('inferred') ? 'inferred' : (u.joins.length ? 'explicit' : 'fallback'),
      degraded: degradedSources,
      // workRef only when the tracker confirmed the issue; a bare token is a
      // join key (kept as the unit id), not evidence that the issue exists.
      workRef: u.issue
        ? { provider: 'linear', issueKey: u.issue.identifier, url: u.issue.url, state: u.issue.stateName, priority: u.issue.priorityLabel, title: u.issue.title }
        : null,
      executionRef: (u.worktrees.length || u.sessions.length)
        ? {
            repo: [...u.repoNames][0] || null,
            branch: (u.worktrees[0] && u.worktrees[0].branch) || null,
            worktreePath: (u.worktrees[0] && u.worktrees[0].path) || null,
            dirty: u.worktrees[0] ? u.worktrees[0].dirty : null,
            ahead: u.worktrees[0] ? u.worktrees[0].ahead : null,
            behind: u.worktrees[0] ? u.worktrees[0].behind : null,
            sessions: u.sessions.slice(0, 5).map((s) => ({ id: s.id, harness: s.harness, lastRole: s.lastRole, age: relAge(s.ageMs, now) })),
          }
        : null,
      proofRef: u.prs.length || u.mergedPrs.length
        ? {
            prNumber: (u.prs[0] && u.prs[0].number) || (u.mergedPrs[0] && u.mergedPrs[0].number) || null,
            prUrl: (u.prs[0] && u.prs[0].url) || (u.mergedPrs[0] && u.mergedPrs[0].url) || null,
            prState: u.prs.length ? 'open' : 'merged',
            isDraft: u.prs[0] ? !!u.prs[0].isDraft : null,
            checks: u.prs[0] ? u.prs[0].checks : null,
            reviewDecision: u.prs[0] ? u.prs[0].reviewDecision || null : null,
          }
        : null,
      age: relAge(lastActivityMs, now),
      ageHours: lastActivityMs !== null ? Math.round(((now - lastActivityMs) / 3.6e6) * 10) / 10 : null,
      next,
    };

    if (lane) lanes[lane].push(item);
    else diagnostics.push({ type: 'unlaned-unit', id: u.id, reason: 'matched no lane definition', item });
  }

  // Lane-internal ordering: most urgent first.
  lanes.needsYou.sort((a, b) => (a.ageHours ?? 1e9) - (b.ageHours ?? 1e9));
  lanes.readyForReview.sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0));
  lanes.stale.sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0));

  // Nothing silently dropped: unattached and out-of-scope sessions are counted.
  for (const [repoName, counts] of unattachedByRepo) {
    diagnostics.push({ type: 'unattached-sessions', repo: repoName, sessions: counts.sessions, needsYou: counts.needsYou, reason: 'sessions inside the repo joined no issue, branch, or worktree unit' });
  }
  if (outOfScope > 0) diagnostics.push({ type: 'sessions-out-of-scope', count: outOfScope, reason: 'recent sessions whose cwd is outside every configured repo' });

  return { lanes, diagnostics, degraded };
}

// ---- output -----------------------------------------------------------------------

function headerLine(lanes, degraded) {
  const parts = [
    `${lanes.needsYou.length} need${lanes.needsYou.length === 1 ? 's' : ''} you`,
    `${lanes.readyForReview.length} ready for review`,
    `${lanes.blockedOnAgent.length} blocked on agent`,
    `${lanes.stale.length} stale`,
    `${lanes.missingOwner.length} unowned`,
    `${lanes.verified.length} verified`,
  ];
  const degradedSources = Object.entries(degraded).filter(([, v]) => v).map(([k]) => k);
  return `pulse: ${parts.join(', ')}${degradedSources.length ? ` (degraded: ${degradedSources.join(', ')})` : ''}`;
}

// The human board stays calm on huge fleets: needs-you always prints in full
// (it is the point of the tool); every other lane caps its listing and says
// how much more there is. Counts in the header and --json are never capped.
const HUMAN_LANE_CAP = 15;

function renderHuman(result, out = console.log) {
  out(headerLine(result.lanes, result.degraded));
  const order = ['needsYou', 'readyForReview', 'blockedOnAgent', 'stale', 'missingOwner', 'verified'];
  for (const laneKey of order) {
    const all = result.lanes[laneKey];
    if (!all.length) continue;
    const items = laneKey === 'needsYou' ? all : all.slice(0, HUMAN_LANE_CAP);
    out('');
    out(`${LANE_LABELS[laneKey]} (${all.length})`);
    for (const item of items) {
      const bits = [item.id];
      if (item.title && item.title !== item.id) bits.push(String(item.title).slice(0, 70));
      if (item.age) bits.push(item.age);
      if (item.confidence !== 'explicit') bits.push(`[${item.confidence}]`);
      if (item.degraded.length) bits.push(`[degraded: ${item.degraded.join(',')}]`);
      out(`  ${bits.join('  ')}`);
      if (laneKey !== 'verified' && item.next) {
        out(`      next: ${item.next.action}${item.next.ref ? `  ${item.next.ref}` : ''}`);
      }
    }
    if (all.length > items.length) {
      out(`  ... and ${all.length - items.length} more (use --lane ${LANE_LABELS[laneKey]} with --json for the rest)`);
    }
  }
  const degradedEntries = Object.entries(result.degraded).filter(([, v]) => v);
  if (degradedEntries.length) {
    out('');
    out('degraded sources (data above is incomplete, not empty):');
    for (const [source, reason] of degradedEntries) out(`  ${source}: ${reason}`);
  }
  if (result.diagnostics.length) {
    out('');
    out(`diagnostics (${result.diagnostics.length}): run with --json for details`);
  }
}

// ---- entry ------------------------------------------------------------------------

const LANE_FLAG_MAP = {
  'needs-you': 'needsYou',
  'ready-for-review': 'readyForReview',
  'blocked-on-agent': 'blockedOnAgent',
  stale: 'stale',
  'missing-owner': 'missingOwner',
  unowned: 'missingOwner',
  verified: 'verified',
};

function filterResult(result, { repo, lane }) {
  const lanes = {};
  for (const key of LANE_KEYS) {
    let items = result.lanes[key];
    if (repo) items = items.filter((i) => i.executionRef && i.executionRef.repo === repo);
    if (lane && LANE_FLAG_MAP[lane] !== key) items = [];
    lanes[key] = items;
  }
  return { ...result, lanes };
}

async function runPulse(flags, io = {}) {
  const out = io.out || console.log;
  const err = io.err || console.error;
  const { config, error } = loadConfig(flags.config);
  if (!config) { err(`humanctl pulse: ${error}`); return 1; }
  if (flags.lane && !LANE_FLAG_MAP[String(flags.lane)]) {
    err(`humanctl pulse: unknown lane "${flags.lane}" (use ${Object.keys(LANE_FLAG_MAP).join(', ')})`);
    return 1;
  }
  if (flags.repo && !config.repos.some((r) => r.name === flags.repo)) {
    err(`humanctl pulse: unknown repo "${flags.repo}" (configured: ${config.repos.map((r) => r.name).join(', ') || 'none'})`);
    return 1;
  }

  const collected = await collect(config, { fresh: !!flags.fresh });
  const result = reconcile(collected, config);
  const filtered = (flags.repo || flags.lane) ? filterResult(result, { repo: flags.repo, lane: flags.lane }) : result;

  if (flags.json) {
    out(JSON.stringify({
      generatedAt: new Date(collected.now).toISOString(),
      config: {
        reposScanned: config.repos.map((r) => r.name),
        linearScope: config.linear
          ? { workspace: config.linear.workspace, teams: config.linear.teams, states: config.linear.states, assignee: config.linear.assignee }
          : null,
      },
      lanes: filtered.lanes,
      diagnostics: filtered.diagnostics,
      degraded: filtered.degraded,
    }, null, 2));
  } else {
    renderHuman(filtered, out);
  }
  return 0;
}

module.exports = {
  runPulse,
  reconcile,
  collect,
  loadConfig,
  summarizeChecks,
  parseWorktreePorcelain,
  parseUpstreamTrack,
  computeOpenNotes,
  headerLine,
  NEED_DECAY_MS,
  LANE_LABELS,
};
