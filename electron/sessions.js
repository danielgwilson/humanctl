'use strict';

// Cross-harness session reader for the humanctl local app.
// Read-only. Scans local Codex + Claude Code session transcripts and returns
// recent-session metadata. Never writes, never transmits. Huge transcripts are
// read by bounded head/tail slices, never fully loaded.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const HARNESSES = [
  { name: 'codex', dir: path.join(HOME, '.codex', 'sessions') },
  { name: 'claude-code', dir: path.join(HOME, '.claude', 'projects') },
];

const HEAD_BYTES = 256 * 1024; // enough for session meta + first real prompt
const TAIL_BYTES = 128 * 1024; // enough for current state

function walkJsonl(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
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
  return /^# AGENTS\.md|^<INSTRUCTIONS|^<skill|^<environment_context|^<subagent|^<turn_aborted|^<channel|^<local-command|^<task-notification|^<command-message|^<command-name|^<system-reminder|^This session is being continued|^Caveat: The messages below/.test(t);
}

function textOf(content, claude) {
  if (Array.isArray(content)) {
    return content
      .map((x) => (x && (claude ? x.type === 'text' : true) ? (x.text || '') : ''))
      .join(' ');
  }
  return typeof content === 'string' ? content : '';
}

function metaFor(file, harness) {
  const head = readSlice(file, HEAD_BYTES, false).split('\n');
  let cwd = '';
  let title = '';
  for (const ln of head) {
    const o = parse(ln);
    if (!o) continue;
    const p = o.payload || o;
    if (!cwd) cwd = p.cwd || o.cwd || (o.message && o.message.cwd) || '';
    if (!title) {
      const isClaude = harness === 'claude-code';
      const role = (p.role) || (o.message && o.message.role);
      const content = isClaude ? (o.message && o.message.content) : p.content;
      if (role === 'user') {
        const txt = textOf(content, isClaude).trim();
        if (txt && !isBoilerplate(txt)) title = txt.replace(/\s+/g, ' ').slice(0, 140);
      }
    }
    if (cwd && title) break;
  }
  return { cwd, title };
}

function lastRole(file, harness) {
  const tail = readSlice(file, TAIL_BYTES, true).split('\n').map(parse).filter(Boolean);
  for (let i = tail.length - 1; i >= 0; i--) {
    const o = tail[i];
    const p = o.payload || o;
    const role = p.role || (o.message && o.message.role);
    if (role) return role;
  }
  return 'unknown';
}

function relAge(ms) {
  const h = (Date.now() - ms) / 3.6e6;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm';
  if (h < 48) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}

// Public: recent top-level sessions across harnesses (excludes subagent/workflow children).
function listRecent(opts = {}) {
  const maxAgeH = opts.maxAgeH || 72;
  const limit = opts.limit || 40;
  const cutoff = Date.now() - maxAgeH * 3.6e6;
  const rows = [];
  for (const h of HARNESSES) {
    const files = [];
    walkJsonl(h.dir, files);
    for (const file of files) {
      if (file.includes('/subagents/') || file.includes('/workflows/')) continue; // child agents
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const { cwd, title } = metaFor(file, h.name);
      rows.push({
        harness: h.name,
        id: path.basename(file).replace(/\.jsonl$/, ''),
        cwd,
        repo: cwd ? cwd.replace(HOME, '~') : '',
        title: title || '(no prompt found)',
        lastRole: lastRole(file, h.name),
        ageMs: st.mtimeMs,
        age: relAge(st.mtimeMs),
        sizeBytes: st.size,
        path: file,
      });
    }
  }
  rows.sort((a, b) => b.ageMs - a.ageMs);
  return rows.slice(0, limit);
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

module.exports = { listRecent, readBlocks, HARNESSES, KINDS };

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
