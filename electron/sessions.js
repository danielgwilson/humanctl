'use strict';

// Cross-harness session reader for the humanctl local app.
// Read-only. Scans local Codex + Claude Code session transcripts and returns
// recent-session metadata. Never writes, never transmits. Huge transcripts are
// read by bounded head/tail slices, never fully loaded.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { priceFor, contextWindowFor, AS_OF } = require('./pricing');

const HOME = os.homedir();
const HARNESSES = [
  { name: 'codex', dir: path.join(HOME, '.codex', 'sessions') },
  { name: 'claude-code', dir: path.join(HOME, '.claude', 'projects') },
];

const HEAD_BYTES = 256 * 1024; // enough for session meta + first real prompt
const TAIL_BYTES = 128 * 1024; // enough for current state

// Codex stores rollouts under sessions/YYYY/MM/DD. When a minYear is given we
// skip whole year directories older than it: a file modified within the recency
// window cannot live in a year before the cutoff's year (true even across a
// new-year boundary, since minYear is the cutoff's own year). This avoids
// statting thousands of archived transcripts on every scan. Safe for Claude too,
// whose project dirs are never named as bare 4-digit years.
function walkJsonl(dir, out, minYear) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (minYear && /^\d{4}$/.test(e.name) && +e.name < minYear) continue; // skip archived years
      walkJsonl(p, out, minYear);
    } else if (e.name.endsWith('.jsonl')) out.push(p);
  }
}

function readSlice(file, bytes, fromEnd) {
  try {
    const { size } = fs.statSync(file);
    const len = Math.min(bytes, size);
    const start = fromEnd ? size - len : 0;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}

const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };

function isBoilerplate(t) {
  if (!t) return true;
  return /^# AGENTS\.md|^<INSTRUCTIONS|^<skill|^<environment_context|^<subagent|^<turn_aborted|^<channel|^<local-command|^<task-notification|^<command-message|^<command-name|^<system-reminder|^This session is being continued|^Caveat: The messages below|^\[Request interrupted|^\[Request\]/.test(t);
}

function textOf(content, claude) {
  if (Array.isArray(content)) {
    return content
      .map((x) => (x && (claude ? x.type === 'text' : true) ? (x.text || '') : ''))
      .join(' ');
  }
  return typeof content === 'string' ? content : '';
}

// Codex auto-spawns subagent sub-threads (and headless `codex exec` runs) as
// top-level rollout files. They are not human-driven sessions, so treat them as
// automation and hide them by default. Newer Codex versions also stamp
// session_meta with thread_source ("user" / "subagent" / "automation"), which
// catches scheduled automation runs directly, without the prompt-shape check
// in metaFor. bin/humanctl.js span mirrors these semantics; keep them in sync.
function isCodexAutomation(meta) {
  if (!meta) return false;
  if (meta.parent_thread_id) return true;
  if (meta.agent_role || meta.agent_nickname) return true;
  if (meta.source && typeof meta.source === 'object' && meta.source.subagent) return true;
  if (meta.originator === 'codex_exec' || meta.source === 'exec') return true;
  if (meta.thread_source === 'subagent' || meta.thread_source === 'automation') return true;
  return false;
}

// metaFor + lastRole each read a slice of every recent file on every scan.
// They only change when the file changes, so memoize by (path, mtime, size).
// This is what keeps the main thread from re-parsing ~1300 transcripts per tick.
const metaCache = new Map();
const roleCache = new Map();

function metaFor(file, harness, st) {
  if (st === undefined) { try { st = fs.statSync(file); } catch { st = null; } }
  const ckey = st ? `${file}:${st.mtimeMs}:${st.size}` : file;
  if (metaCache.has(ckey)) return metaCache.get(ckey);
  const head = readSlice(file, HEAD_BYTES, false).split('\n');
  let cwd = '';
  let title = '';
  let customTitle = '';   // Claude Code user rename, logged as {type:'custom-title'} and re-emitted near the top
  let automation = false;
  let sawMeta = false;
  let scanned = 0;
  for (const ln of head) {
    scanned++;
    const o = parse(ln);
    if (!o) continue;
    if (o.type === 'custom-title' && o.customTitle) customTitle = String(o.customTitle);
    const p = o.payload || o;
    if (!cwd) cwd = p.cwd || o.cwd || (o.message && o.message.cwd) || '';
    if (harness === 'codex' && !sawMeta && (p.originator || p.source || p.parent_thread_id || p.cli_version)) {
      sawMeta = true;
      automation = isCodexAutomation(p);
    }
    if (!title) {
      const isClaude = harness === 'claude-code';
      const role = (p.role) || (o.message && o.message.role);
      const content = isClaude ? (o.message && o.message.content) : p.content;
      if (role === 'user') {
        const txt = textOf(content, isClaude).trim();
        if (txt && !isBoilerplate(txt)) title = txt.replace(/\s+/g, ' ').slice(0, 140);
      }
    }
    // keep scanning a little past cwd+title to catch the (early, repeated) rename line
    if (cwd && title && (customTitle || scanned > 120)) break;
  }
  // machine-generated sessions, by prompt shape: codex scheduled runs
  // ("Automation: <name> Automation ID: <id>") and the headless `claude -p`
  // one-shots our own AI-summary feature spawns.
  if (!automation && title && (
    (/^Automation:/i.test(title) && /Automation ID:/i.test(title)) ||
    /^Summarize the recent tail of an autonomous coding-agent session/i.test(title)
  )) automation = true;
  const res = { cwd, title, customTitle, automation };
  metaCache.set(ckey, res);
  if (metaCache.size > 1500) metaCache.clear();
  return res;
}

function lastRole(file, harness, st) {
  if (st === undefined) { try { st = fs.statSync(file); } catch { st = null; } }
  const ckey = st ? `${file}:${st.mtimeMs}:${st.size}` : file;
  if (roleCache.has(ckey)) return roleCache.get(ckey);
  const tail = readSlice(file, TAIL_BYTES, true).split('\n').map(parse).filter(Boolean);
  let role = 'unknown';
  for (let i = tail.length - 1; i >= 0; i--) {
    const o = tail[i];
    const p = o.payload || o;
    const r = p.role || (o.message && o.message.role);
    if (r) { role = r; break; }
  }
  roleCache.set(ckey, role);
  if (roleCache.size > 1500) roleCache.clear();
  return role;
}

function relAge(ms) {
  const h = (Date.now() - ms) / 3.6e6;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm';
  if (h < 48) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}

// The tree walk + per-file meta/role reads are the expensive part, and are
// identical whether or not usage is requested. Cache the base row list for a
// short window so listSessions + getStatus in the same refresh pay it once, not
// twice. Per-file work underneath is already mtime-memoized (metaCache/roleCache).
const scanCache = new Map(); // key -> { at, rows }
const SCAN_TTL_MS = 1500;
function baseScan(maxAgeH, limit, includeAutomation) {
  const key = `${maxAgeH}:${limit}:${!!includeAutomation}`;
  const hit = scanCache.get(key);
  if (hit && Date.now() - hit.at < SCAN_TTL_MS) return hit.rows;
  const cutoff = Date.now() - maxAgeH * 3.6e6;
  const minYear = new Date(cutoff).getFullYear();
  const rows = [];
  for (const h of HARNESSES) {
    const files = [];
    walkJsonl(h.dir, files, minYear);
    for (const file of files) {
      if (file.includes('/subagents/') || file.includes('/workflows/')) continue; // child agents
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const { cwd, title, customTitle, automation } = metaFor(file, h.name, st);
      if (automation && !includeAutomation) continue; // hide codex subagent / exec noise
      rows.push({
        harness: h.name,
        id: path.basename(file).replace(/\.jsonl$/, ''),
        cwd,
        repo: cwd ? cwd.replace(HOME, '~') : '',
        title: title || '',
        customTitle: customTitle || '',
        lastRole: lastRole(file, h.name, st),
        ageMs: st.mtimeMs,
        age: relAge(st.mtimeMs),
        sizeBytes: st.size,
        path: file,
      });
    }
  }
  rows.sort((a, b) => b.ageMs - a.ageMs);
  const out = rows.slice(0, limit);
  scanCache.set(key, { at: Date.now(), rows: out });
  return out;
}

// Codex keeps the (renamed or auto-generated) thread title in its local SQLite
// state DB, not the rollout file. Read it read-only via the system sqlite3
// (always present on macOS), keyed by thread id (the PK, so lookups are indexed),
// batched for the displayed rows, cached by the DB mtime. Purely additive: any
// failure (no sqlite3, locked DB, schema drift) just leaves customTitle unset.
const CODEX_STATE_DB = path.join(HOME, '.codex', 'state_5.sqlite');
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const codexTitleCache = new Map(); // `${uuid}:${dbMtime}` -> title ('' if none)
function applyCodexTitles(rows) {
  let dbm; try { dbm = fs.statSync(CODEX_STATE_DB).mtimeMs; } catch { return; }
  const need = [];
  for (const r of rows) {
    const m = String(r.id).match(UUID_RE);
    if (!m) continue;
    r._uuid = m[1];
    const k = `${r._uuid}:${dbm}`;
    if (codexTitleCache.has(k)) { const v = codexTitleCache.get(k); if (v) r.customTitle = v; }
    else need.push(r._uuid);
  }
  if (!need.length) return;
  let qrows = [];
  try {
    const inList = need.map((u) => `'${u}'`).join(','); // uuids are hex, safe to inline
    const raw = execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', CODEX_STATE_DB,
      `SELECT id, title FROM threads WHERE id IN (${inList}) AND title != ''`],
      { timeout: 4000, encoding: 'utf8', maxBuffer: 8 << 20 });
    qrows = raw.trim() ? JSON.parse(raw) : [];
  } catch { qrows = []; }
  const found = {};
  for (const q of qrows) { const t = String(q.title || '').replace(/\s+/g, ' ').trim().slice(0, 120); if (t) found[q.id] = t; }
  for (const u of need) codexTitleCache.set(`${u}:${dbm}`, found[u] || '');
  for (const r of rows) if (r._uuid && found[r._uuid]) r.customTitle = found[r._uuid];
  if (codexTitleCache.size > 3000) codexTitleCache.clear();
}

// Public: recent top-level sessions across harnesses (excludes subagent/workflow children).
function listRecent(opts = {}) {
  const out = baseScan(opts.maxAgeH || 72, opts.limit || 40, opts.includeAutomation);
  if (opts.withUsage) {
    for (const r of out) {
      const u = readUsage(r.path, r.harness);
      if (u) {
        r.contextPct = u.contextPct;
        r.costUSD = u.costUSD;
        r.apiEquivUSD = u.apiEquivUSD;
        r.totalTokens = (u.tokens && u.tokens.total) || 0;
      }
      const x = readRowExtras(r.path, r.harness);
      if (x) {
        r.lastUser = x.lastUser;
        r.prevAgent = x.prevAgent;
        r.reasoningEffort = x.reasoningEffort;
        r.ultracode = x.ultracode;
        r.model = x.model || (u && u.model) || '';
        if (x.customTitle) r.customTitle = x.customTitle; // tail value is the most recent rename
      } else if (u) {
        r.model = u.model;
      }
    }
    // Codex titles live in the state DB, not the transcript: fill them for the displayed rows.
    applyCodexTitles(out.filter((r) => r.harness === 'codex'));
  }
  return out;
}

// --- Per-session context map -------------------------------------------------
// Normalize a transcript into an ordered sequence of blocks by kind, with a
// rough token estimate per block. Used by the desktop "context map" view.
// Read-only; reads at most MAX_READ bytes from the start of the file.

const MAX_READ = 12 * 1024 * 1024; // 12MB head; huge sessions are truncated
const MAX_BLOCKS = 4000; // keep the DOM sane on very long sessions
const KINDS = ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'meta'];

const estTokens = (s) => Math.max(1, Math.ceil((s || '').length / 4));
const previewOf = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 120);

function arrText(content) {
  if (Array.isArray(content)) return content.map((x) => (x && (x.text || x.thinking)) || '').join(' ');
  return typeof content === 'string' ? content : '';
}

// Return an array of {kind, text} for one transcript line (may be empty).
function blocksForLine(o, claude) {
  if (claude) {
    const msg = o.message || {};
    const role = msg.role;
    const content = msg.content;
    if (!role) return [];
    if (typeof content === 'string') {
      if (role === 'user') return [{ kind: isBoilerplate(content.trim()) ? 'meta' : 'user', text: content }];
      return [{ kind: 'assistant', text: content }];
    }
    if (!Array.isArray(content)) return [];
    const out = [];
    for (const item of content) {
      if (!item) continue;
      if (item.type === 'thinking') out.push({ kind: 'thinking', text: item.thinking || '' });
      else if (item.type === 'tool_use') out.push({ kind: 'tool-call', text: (item.name || '') + ' ' + JSON.stringify(item.input || '') });
      else if (item.type === 'tool_result') out.push({ kind: 'tool-result', text: arrText(item.content) });
      else if (item.type === 'text') {
        const t = item.text || '';
        if (role === 'user') out.push({ kind: isBoilerplate(t.trim()) ? 'meta' : 'user', text: t });
        else out.push({ kind: 'assistant', text: t });
      }
    }
    return out;
  }
  // codex rollout
  const p = o.payload || o;
  const type = p.type;
  if (type === 'reasoning') return [{ kind: 'thinking', text: arrText(p.summary) || arrText(p.content) }];
  if (type === 'function_call' || type === 'local_shell_call' || type === 'custom_tool_call')
    return [{ kind: 'tool-call', text: (p.name || p.action || '') + ' ' + (typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments || '')) }];
  if (type === 'function_call_output' || type === 'custom_tool_call_output' || type === 'local_shell_call_output')
    return [{ kind: 'tool-result', text: typeof p.output === 'string' ? p.output : JSON.stringify(p.output || '') }];
  const role = p.role;
  if (role === 'user' || role === 'assistant') {
    const t = arrText(p.content);
    if (!t) return [];
    if (role === 'user') return [{ kind: isBoilerplate(t.trim()) ? 'meta' : 'user', text: t }];
    return [{ kind: 'assistant', text: t }];
  }
  return [];
}

function readBlocks(file, opts = {}) {
  const harness = opts.harness || (file.includes('/.claude/') ? 'claude-code' : 'codex');
  const claude = harness === 'claude-code';
  const lines = readSlice(file, MAX_READ, false).split('\n');
  const blocks = [];
  let truncated = false;
  for (const ln of lines) {
    if (!ln) continue;
    const o = parse(ln);
    if (!o) continue;
    for (const b of blocksForLine(o, claude)) {
      if (!b.text) continue;
      if (blocks.length >= MAX_BLOCKS) { truncated = true; break; }
      blocks.push({ kind: KINDS.includes(b.kind) ? b.kind : 'meta', tokens: estTokens(b.text), preview: previewOf(b.text) });
    }
    if (truncated) break;
  }
  let size = 0;
  try { size = fs.statSync(file).size; } catch {}
  if (size > MAX_READ) truncated = true;
  return { id: path.basename(file).replace(/\.jsonl$/, ''), harness, blocks, truncated };
}

// --- Token usage, cost estimate, and quota -----------------------------------
// Real token usage is recorded in both harnesses: Claude per assistant message
// (message.usage + model), Codex in token_count events (cumulative totals +
// live rate limits). We read it, estimate spend from pricing.js, and surface
// Codex rate limits as a real quota track. Cached by path+mtime+size so live
// refresh does not re-read unchanged files. Read-only.

const usageCache = new Map();

function readClaudeUsage(file) {
  const lines = readSlice(file, MAX_READ, false).split('\n');
  let inT = 0, out = 0, cr = 0, cc = 0, model = '', lastCtx = 0;
  for (const ln of lines) {
    if (!ln) continue;
    const o = parse(ln);
    const m = o && o.message;
    if (!m || m.role !== 'assistant' || !m.usage) continue;
    const u = m.usage;
    inT += u.input_tokens || 0;
    out += u.output_tokens || 0;
    cr += u.cache_read_input_tokens || 0;
    cc += u.cache_creation_input_tokens || 0;
    if (m.model) model = m.model;
    // the last assistant turn's input is the live context-window occupancy
    lastCtx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  }
  const p = priceFor(model);
  const costUSD = (inT * p.in + out * p.out + cr * p.cacheRead + cc * p.cacheWrite) / 1e6;
  const ctxWin = contextWindowFor(model);
  return { harness: 'claude-code', model, metered: true, costUSD, apiEquivUSD: null, rateLimits: null,
    contextWindow: ctxWin, contextTokens: lastCtx, contextPct: ctxWin ? Math.min(100, Math.round((lastCtx / ctxWin) * 100)) : null,
    tokens: { input: inT, output: out, cacheRead: cr, cacheCreate: cc, total: inT + out + cr + cc } };
}

function readCodexUsage(file) {
  const tail = readSlice(file, 1024 * 1024, true).split('\n');
  let last = null;
  for (let i = tail.length - 1; i >= 0; i--) {
    const o = parse(tail[i]);
    const p = o && (o.payload || o);
    if (p && p.type === 'token_count') { last = p; break; }
  }
  if (!last || !last.info) {
    return { harness: 'codex', model: '', metered: false, costUSD: null, apiEquivUSD: null, rateLimits: null, tokens: { total: 0 } };
  }
  const tu = last.info.total_token_usage || {};
  const lu = last.info.last_token_usage || {};
  const inT = tu.input_tokens || 0, out = tu.output_tokens || 0, cached = tu.cached_input_tokens || 0, reasoning = tu.reasoning_output_tokens || 0;
  const p = priceFor('codex');
  const freshIn = Math.max(0, inT - cached);
  const apiEquivUSD = (freshIn * p.in + cached * p.cacheRead + out * p.out) / 1e6;
  const ctxWin = last.info.model_context_window || null;
  const ctxTokens = lu.input_tokens || 0; // last turn's input = live window occupancy
  return { harness: 'codex', model: last.info.model || '', metered: false, costUSD: null, apiEquivUSD,
    rateLimits: last.rate_limits || null, contextWindow: ctxWin, contextTokens: ctxTokens,
    contextPct: ctxWin ? Math.min(100, Math.round((ctxTokens / ctxWin) * 100)) : null,
    tokens: { input: inT, cached, output: out, reasoning, total: tu.total_tokens || 0 } };
}

// Public: per-session usage. Cheap on repeat calls (mtime+size cache).
function readUsage(file, harness) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}:${st.mtimeMs}:${st.size}`;
  if (usageCache.has(key)) return usageCache.get(key);
  const claude = harness === 'claude-code' || file.includes('/.claude/');
  const result = claude ? readClaudeUsage(file) : readCodexUsage(file);
  usageCache.set(key, result);
  if (usageCache.size > 800) usageCache.clear();
  return result;
}

// Public: account-level rollup for the top bar. Real spend estimate for Claude
// (metered), real rate-limit quota for Codex (plan-billed), and a needs-you count.
function accountStatus(opts = {}) {
  const rows = listRecent(opts);
  const per = {
    codex: { sessions: 0, generated: 0, totalTokens: 0, apiEquivUSD: 0 },
    'claude-code': { sessions: 0, generated: 0, totalTokens: 0, costUSD: 0 },
  };
  let codexQuota = null, codexQuotaAge = Infinity, nearCompaction = 0;
  for (const r of rows) {
    const u = readUsage(r.path, r.harness);
    if (!u) continue;
    const b = per[r.harness];
    if (!b) continue;
    b.sessions++;
    b.totalTokens += (u.tokens && u.tokens.total) || 0;
    if (u.contextPct != null && u.contextPct >= 80) nearCompaction++;
    if (r.harness === 'claude-code') {
      b.generated += (u.tokens && u.tokens.output) || 0;
      b.costUSD += u.costUSD || 0;
    } else {
      b.generated += ((u.tokens && u.tokens.output) || 0) + ((u.tokens && u.tokens.reasoning) || 0);
      b.apiEquivUSD += u.apiEquivUSD || 0;
      const ageFromNow = Date.now() - r.ageMs;
      if (u.rateLimits && ageFromNow < codexQuotaAge) { codexQuota = u.rateLimits; codexQuotaAge = ageFromNow; }
    }
  }
  return {
    per,
    codexQuota,
    needsYou: rows.filter((r) => r.lastRole === 'assistant').length,
    working: rows.filter((r) => r.lastRole === 'user').length,
    nearCompaction,
    sessions: rows.length,
    pricingAsOf: AS_OF,
    generatedAt: Date.now(),
  };
}

// --- Rich extraction: last-exchange, Linear refs, generated HTML, skills, effort, ultracode ---

const rowCache = new Map();
const detailCache = new Map();
const LINEAR_RE = /https?:\/\/linear\.app\/[a-z0-9-]+\/(?:issue|project)\/[^\s)"'<>\]]+/gi;

const clip = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
function assistantText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((x) => x && x.type === 'text').map((x) => x.text || '').join(' ');
  return '';
}
function genuineUserText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    if (content.some((x) => x && x.type === 'tool_result')) return '';
    return content.filter((x) => x && x.type === 'text').map((x) => x.text || '').join(' ');
  }
  return '';
}
function linearLabel(u) {
  const im = u.match(/\/issue\/([A-Za-z0-9]+-\d+)/);
  if (im) return im[1].toUpperCase();
  const pm = u.match(/\/project\/([a-z0-9-]+)/i);
  if (pm) return pm[1].replace(/-[0-9a-f]{8,}$/i, '').replace(/-/g, ' ').split(' ').filter(Boolean).slice(0, 4).join(' ') || 'project';
  return 'linear';
}
function collectLinear(text, map) {
  if (!text) return;
  const m = String(text).match(LINEAR_RE);
  if (!m) return;
  for (let u of m) { u = u.replace(/[).,\]]+$/, ''); if (!map.has(u)) map.set(u, { url: u, label: linearLabel(u) }); }
}
function collectHtmlFromCmd(cmd, set) {
  if (!cmd) return;
  const m = String(cmd).match(/\/[^\s"'>|;]+\.html?\b/g);
  if (m) for (const p of m) set.add(p);
}

// Light, tail-only per-row extras (cheap, cached): last user prompt + preceding
// agent message, model, reasoning effort, ultracode flag.
function readRowExtras(file, harness) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}:${st.mtimeMs}:${st.size}`;
  if (rowCache.has(key)) return rowCache.get(key);
  const claude = harness === 'claude-code' || file.includes('/.claude/');
  // Codex logs are dense (token_count/function events), so genuine user turns can
  // sit well back from the end; read a larger tail there.
  const tailBytes = claude ? 768 * 1024 : 3 * 1024 * 1024;
  const lines = readSlice(file, tailBytes, true).split('\n');
  if (lines.length) lines.shift(); // drop possibly-partial first line of the tail
  let lastUser = '', prevAgent = '', rollingAgent = '', model = '', effort = '', ultra = false, customTitle = '';
  for (const ln of lines) {
    if (!ln) continue;
    const o = parse(ln);
    if (!o) continue;
    if (claude) {
      if (o.type === 'custom-title' && o.customTitle) { customTitle = String(o.customTitle); continue; }
      if (o.type === 'attachment' && o.attachment) {
        if (o.attachment.type === 'ultra_effort_enter') ultra = true;
        else if (o.attachment.type === 'ultra_effort_exit') ultra = false;
        continue;
      }
      const m = o.message;
      if (!m) continue;
      if (m.model) model = m.model;
      if (m.role === 'assistant') { const t = assistantText(m.content); if (t) rollingAgent = t; }
      else if (m.role === 'user') { const t = genuineUserText(m.content); if (t && !isBoilerplate(t.trim())) { lastUser = t; prevAgent = rollingAgent; } }
    } else {
      const p = o.payload || {};
      if (o.type === 'turn_context') { if (p.model) model = p.model; if (p.effort) effort = p.effort; continue; }
      const pt = p.type || o.type;
      if (pt === 'agent_message' && p.message) rollingAgent = String(p.message);
      else if (pt === 'user_message' && p.message) { const t = String(p.message); if (!isBoilerplate(t.trim())) { lastUser = t; prevAgent = rollingAgent; } }
    }
  }
  if (!claude) ultra = effort === 'xhigh';
  const res = { lastUser: clip(lastUser, 200), prevAgent: clip(prevAgent, 200), model, reasoningEffort: effort || null, ultracode: ultra, customTitle: customTitle || '' };
  rowCache.set(key, res);
  if (rowCache.size > 800) rowCache.clear();
  return res;
}

// Full per-session extraction for the detail view (cached by mtime).
function readDetail(file, harness) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}:${st.mtimeMs}:${st.size}`;
  if (detailCache.has(key)) return detailCache.get(key);
  const claude = harness === 'claude-code' || file.includes('/.claude/');
  const lines = readSlice(file, MAX_READ, false).split('\n');
  let lastUser = '', prevAgent = '', rollingAgent = '', model = '', effort = '', ultra = false, skillCount = 0;
  const skills = {}, linear = new Map(), html = new Set();
  for (const ln of lines) {
    if (!ln) continue;
    const o = parse(ln);
    if (!o) continue;
    if (claude) {
      if (o.type === 'attachment' && o.attachment) {
        if (o.attachment.type === 'ultra_effort_enter') ultra = true;
        else if (o.attachment.type === 'ultra_effort_exit') ultra = false;
        continue;
      }
      const m = o.message;
      if (!m) continue;
      if (m.model) model = m.model;
      const content = m.content;
      if (m.role === 'assistant') {
        const t = assistantText(content); if (t) { rollingAgent = t; collectLinear(t, linear); }
        if (Array.isArray(content)) for (const it of content) {
          if (!it || it.type !== 'tool_use') continue;
          if (it.name === 'Skill' && it.input && it.input.skill) { skills[it.input.skill] = (skills[it.input.skill] || 0) + 1; skillCount++; }
          if ((it.name === 'Write' || it.name === 'Edit') && it.input && typeof it.input.file_path === 'string' && /\.html?$/i.test(it.input.file_path)) html.add(it.input.file_path);
          if (it.name === 'Bash' && it.input && typeof it.input.command === 'string') collectHtmlFromCmd(it.input.command, html);
        }
      } else if (m.role === 'user') {
        const t = genuineUserText(content); if (t && !isBoilerplate(t.trim())) { lastUser = t; prevAgent = rollingAgent; }
        collectLinear(typeof content === 'string' ? content : assistantText(content), linear);
      }
    } else {
      const p = o.payload || {};
      if (o.type === 'turn_context') { if (p.model) model = p.model; if (p.effort) effort = p.effort; continue; }
      const pt = p.type || o.type;
      if (pt === 'agent_message' && p.message) { rollingAgent = String(p.message); collectLinear(rollingAgent, linear); }
      else if (pt === 'user_message' && p.message) { const t = String(p.message); if (!isBoilerplate(t.trim())) { lastUser = t; prevAgent = rollingAgent; } collectLinear(t, linear); }
      else if (pt === 'function_call' || pt === 'custom_tool_call' || pt === 'local_shell_call') { const a = p.arguments; const cmd = typeof a === 'string' ? a : (a && (a.cmd || a.command)) || JSON.stringify(a || ''); collectHtmlFromCmd(cmd, html); collectLinear(cmd, linear); }
      else if (pt === 'message') { const t = arrText(p.content); if (t) collectLinear(t, linear); }
    }
  }
  if (!claude) ultra = effort === 'xhigh';
  const htmlFiles = [...new Set([...html].map((f) => f.replace(/^\/+/, '/')))]
    .filter((f) => { try { return fs.existsSync(f); } catch { return false; } }).slice(0, 40);
  const res = {
    harness: claude ? 'claude-code' : 'codex',
    lastExchange: { lastUser: clip(lastUser, 600), prevAgent: clip(prevAgent, 600) },
    linearRefs: [...linear.values()].slice(0, 16),
    htmlFiles,
    skillsUsed: skills,
    skillCount,
    reasoningEffort: effort || null,
    model,
    ultracode: ultra,
  };
  detailCache.set(key, res);
  if (detailCache.size > 300) detailCache.clear();
  return res;
}

// Aggregate skill usage across recent sessions (Claude only; Codex has no
// structured skill calls). Heavier (full reads), cached; call off the hot path.
function aggregateSkills(opts = {}) {
  const rows = listRecent(opts);
  const skills = {};
  let sessionsWithSkills = 0, totalInvocations = 0;
  for (const r of rows) {
    const d = readDetail(r.path, r.harness);
    if (!d) continue;
    const keys = Object.keys(d.skillsUsed || {});
    if (keys.length) sessionsWithSkills++;
    for (const k of keys) { skills[k] = (skills[k] || 0) + d.skillsUsed[k]; totalInvocations += d.skillsUsed[k]; }
  }
  return { skills, sessionsWithSkills, totalInvocations };
}

// Agent inbox: notes posted by `humanctl note` to ~/.humanctl/notes.jsonl.
const NOTES_FILE = path.join(HOME, '.humanctl', 'notes.jsonl');
const NOTE_LEVELS = new Set(['fyi', 'review', 'blocked', 'done']);
function readNotes(opts = {}) {
  let txt;
  try { txt = readSlice(NOTES_FILE, 512 * 1024, true); } catch { return []; } // bounded tail; file is append-only
  if (!txt) return [];
  const notes = txt.split('\n').filter(Boolean).map((l) => {
    try { const o = JSON.parse(l); return (o && typeof o === 'object' && typeof o.message === 'string' && o.id) ? { ...o, level: NOTE_LEVELS.has(o.level) ? o.level : 'fyi' } : null; } catch { return null; }
  }).filter(Boolean);
  notes.reverse(); // newest first
  return notes.slice(0, opts.limit || 100);
}

module.exports = { listRecent, readBlocks, readUsage, readRowExtras, readDetail, aggregateSkills, accountStatus, readNotes, NOTES_FILE, HARNESSES, KINDS };

// CLI smoke: `node electron/sessions.js` prints a quick table (read-only).
if (require.main === module) {
  const rows = listRecent({ maxAgeH: 72, limit: 15 });
  console.log(`recent sessions: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `${r.age.padStart(4)}  ${r.harness.padEnd(11)}  ${(r.repo || '?').slice(0, 34).padEnd(34)}  ${(r.id).slice(0, 10)}  ${r.title.slice(0, 50)}`
    );
  }
}
