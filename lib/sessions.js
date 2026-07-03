'use strict';

// Cross-harness session reader shared by the humanctl desktop app and CLI.
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

// "Ask the session" probes prefix their injected user turn with this sentinel.
// Claude asks run with --no-session-persistence and write nothing, but Codex
// asks always append into the real rollout (and a future Claude fork path
// would persist too), so persisted probe turns must read as non-substantive:
// never a title, never lastUserText, never a state flip. See docs/ask-session.md.
const BTW_SENTINEL = '[humanctl btw]';
const BTW_RE = /^\[humanctl btw\]/;

function isBoilerplate(t) {
  if (!t) return true;
  return /^# AGENTS\.md|^<INSTRUCTIONS|^<skill|^<environment_context|^<subagent|^<turn_aborted|^<channel|^<local-command|^<task-notification|^<command-message|^<command-name|^<system-reminder|^This session is being continued|^Caveat: The messages below|^\[Request interrupted|^\[Request\]|^\[humanctl btw\]/.test(t);
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

// --- Needs-you v3: obligation detection over the tail CONTENT -----------------
// Who the ball is with cannot be read off lastRole alone: a 2026-07 ground-truth
// audit of 60 real sessions graded the lastRole heuristic at 36% precision.
// The failure modes it found are handled explicitly here:
//   - trailing local commands (/model, /effort) and metadata appends (pr-link,
//     mode, custom-title lines) flip lastRole or refresh mtime without being
//     real conversation: we classify over SUBSTANTIVE events only and age the
//     session by the last substantive event's own timestamp, not file mtime;
//   - progress-shaped assistant tails ("running the deploy now") are the agent
//     working, not an ask: they are only needs-you when the final assistant
//     message is question- or decision-shaped;
//   - a user interrupt with no assistant turn after it means only you can act;
//   - headless one-shot sessions (our own summarizer probes, `claude -p`) are
//     automation noise and are filtered from the interactive list entirely.
// Everything below is a deterministic shape rule over bounded tail slices.
// No model calls, no fabricated signals; every state carries its reason.

// Strong ask patterns: decision- or handoff-shaped phrases scanned over the
// whole final assistant message. Sourced from the audit's true needs-you tails.
const ASK_STRONG = [
  [/\bsay the word\b/i, 'awaiting your go-ahead'],
  [/\bsay ["'`]/i, 'awaiting your go-ahead'],
  [/\byour call\b/i, 'awaiting your decision'],
  [/\bonly you can\b/i, 'an action only you can take'],
  [/\bawaiting your\b/i, 'awaiting your decision'],
  [/\byour (click|move|decision|approval|sign.?off)\b/i, 'awaiting your decision'],
  [/\bstill yours\b/i, 'items still on your desk'],
  [/\btell me (to|which|whether|if|when|how)\b/i, 'asks you a question'],
  [/\bwant you to (confirm|decide|pick|choose|review|approve|weigh)\b/i, 'asks you to confirm'],
  [/\bwaiting (on|for) (you\b|your|a? ?human)/i, 'waiting on you'],
  [/\bhuman (approval|review|sign.?off)\b/i, 'waiting on your review'],
  [/\breview[_\s-]?required\b/i, 'waiting on your review'],
  [/\bblocked on (you\b|your)/i, 'blocked on you'],
  [/\bneeds? your (review|approval|input|call|decision|sign.?off|go\b)/i, 'needs your input'],
  [/\bready for your (review|merge|approval|sign.?off)\b/i, 'ready for your review'],
];
// Soft ask patterns: offer-shaped phrases that only count near the very end of
// the message (mid-message offers are usually already resolved by the tail).
const ASK_SOFT = [
  [/\bwant me to\b/i, 'offers you a next step'],
  [/\bshould i\b/i, 'asks which way to go'],
  [/\bshall i\b/i, 'asks which way to go'],
  [/\bdo you want\b/i, 'asks what you want'],
  [/\bwould you (like|prefer|rather)\b/i, 'asks what you want'],
  [/\bif you (want|like|prefer)\b/i, 'offers you a next step'],
  [/\bif you'd like\b/i, 'offers you a next step'],
  [/\blet me know (which|whether|if|what|how|when)\b/i, 'asks you a question'],
  [/(^|\n)\s*(?:\d+[.)]|[-*])\s*confirm\b/i, 'asks you to confirm'],
];
const ASK_SOFT_WINDOW = 1200; // chars from the end of the final assistant message
const ASK_QUESTION_WINDOW = 300;
// A stale user-last thread was cut off before the agent answered: only you can
// revive it. Flag it only when your parting message actually asked for motion
// (a question or a directive), not a closing acknowledgment.
const REPLY_ASK_RE = /\?|\b(please|yes|let'?s|go ahead|continue|proceed|do it|can you|could you|next|try|fix|make|add|update|run)\b/i;
// Future-tense guard: "I'll report when it's ready for your merge" is progress,
// not an ask. Reject a match whose containing sentence sets it in the future.
const FUTURE_GUARD_RE = /\b(i'?ll|i will|when (it|this|that)|once (it|this|that)|until|going to)\b/i;
// Completion-shaped closure verbs near the end of the final assistant message.
const DONE_RE = /\b(merged|shipped|deployed|released|published|landed|killed|completed?|finished|done and (pushed|merged)|all (checks )?green)\b/i;
const DONE_WINDOW = 300;

function sentenceAround(text, index) {
  const start = Math.max(text.lastIndexOf('.', index), text.lastIndexOf('!', index), text.lastIndexOf('?', index), text.lastIndexOf('\n', index)) + 1;
  return text.slice(start, index);
}
function matchAsk(list, text) {
  for (const [re, reason] of list) {
    const m = re.exec(text);
    if (!m) continue;
    if (FUTURE_GUARD_RE.test(sentenceAround(text, m.index))) continue;
    return reason;
  }
  return null;
}

// Classify the final assistant message: ask-shaped (returns the reason string),
// or null. Question rule: the message, or its last non-empty line within the
// final ~300 chars, ends with a question mark aimed at the reader.
function askShapeOf(text) {
  if (!text) return null;
  const t = String(text).trim();
  const strong = matchAsk(ASK_STRONG, t);
  if (strong) return strong;
  const soft = matchAsk(ASK_SOFT, t.slice(-ASK_SOFT_WINDOW));
  if (soft) return soft;
  const tail = t.slice(-ASK_QUESTION_WINDOW).replace(/[\s"'`)\]*_]+$/, '');
  if (tail.endsWith('?')) return 'asks you a question';
  const lines = t.slice(-ASK_QUESTION_WINDOW).split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length && /\?$/.test(lines[lines.length - 1].replace(/[\s"'`)\]*_]+$/, ''))) return 'asks you a question';
  return null;
}
function doneShapeOf(text) {
  if (!text) return false;
  return DONE_RE.test(String(text).trim().slice(-DONE_WINDOW));
}

// Read the tail of a transcript into normalized substantive events and derive
// the obligation signals. Metadata lines (pr-link, mode, custom-title,
// last-prompt, permission-mode, queue-operation, attachments) and local
// commands (/model, /effort) are excluded from both the event stream and the
// last-activity timestamp: an appended footer must never make a dead thread
// look alive, and a trailing /model must never mask a pending assistant ask.
const NEED_TAIL_BYTES = { 'claude-code': 512 * 1024, codex: 3 * 1024 * 1024 };
const needCache = new Map();
const INTERRUPT_RE = /^\[Request interrupted by user/;

function readNeedSignals(file, harness, st) {
  if (st === undefined) { try { st = fs.statSync(file); } catch { st = null; } }
  const ckey = st ? `${file}:${st.mtimeMs}:${st.size}` : file;
  if (needCache.has(ckey)) return needCache.get(ckey);
  const claude = harness === 'claude-code' || file.includes('/.claude/');
  const sliceBytes = NEED_TAIL_BYTES[claude ? 'claude-code' : 'codex'];
  const wholeFile = !st || st.size <= sliceBytes;
  const lines = readSlice(file, sliceBytes, true).split('\n');
  if (!wholeFile && lines.length) lines.shift(); // drop the possibly-partial first tail line
  const events = []; // { kind: 'user'|'assistant'|'tool'|'interrupt', text?, ts }
  // Probe pair-drop: a persisted "ask the session" turn is a sentinel-prefixed
  // user message plus the answer the model gave it (and any tool noise between).
  // Dropping only the user line is not enough: the probe's ANSWER would still
  // flip lastKind, refresh lastActiveMs, and get classified by askShapeOf,
  // masking a real ask or fabricating one. So a sentinel user event opens a
  // skip window over assistant/tool events until the next genuine user event
  // (or an interrupt, which is always the human acting).
  let probeSkip = false;
  for (const ln of lines) {
    if (!ln) continue;
    const o = parse(ln);
    if (!o) continue;
    const ts = o.timestamp ? Date.parse(o.timestamp) : NaN;
    const tsv = Number.isFinite(ts) ? ts : null;
    if (claude) {
      const m = o.message;
      if (!m || !m.role) continue;
      if (m.role === 'user') {
        if (Array.isArray(m.content) && m.content.some((x) => x && x.type === 'tool_result')) { if (!probeSkip) events.push({ kind: 'tool', ts: tsv }); continue; }
        const t = genuineUserText(m.content).trim();
        if (!t) continue;
        if (INTERRUPT_RE.test(t)) { probeSkip = false; events.push({ kind: 'interrupt', ts: tsv }); continue; }
        if (BTW_RE.test(t)) { probeSkip = true; continue; } // probe question: drop it and its answer
        if (isBoilerplate(t)) continue; // local commands, wrappers, harness meta
        probeSkip = false;
        events.push({ kind: 'user', text: t, ts: tsv });
      } else if (m.role === 'assistant') {
        if (probeSkip) continue;
        const t = assistantText(m.content).trim();
        if (t) events.push({ kind: 'assistant', text: t, ts: tsv });
        if (Array.isArray(m.content) && m.content.some((x) => x && x.type === 'tool_use')) events.push({ kind: 'tool', ts: tsv });
      }
    } else {
      const p = o.payload || o;
      const pt = p.type || o.type;
      if (pt === 'user_message' && p.message) {
        const t = String(p.message).trim();
        if (/<turn_aborted/.test(t)) { probeSkip = false; events.push({ kind: 'interrupt', ts: tsv }); continue; }
        if (!t) continue;
        if (BTW_RE.test(t)) { probeSkip = true; continue; } // probe question: drop it and its answer
        if (isBoilerplate(t)) continue; // wrapper boilerplate never closes a probe window
        probeSkip = false;
        events.push({ kind: 'user', text: t, ts: tsv });
      } else if (pt === 'agent_message' && p.message) {
        if (probeSkip) continue;
        events.push({ kind: 'assistant', text: String(p.message).trim(), ts: tsv });
      } else if (pt === 'turn_aborted') {
        probeSkip = false;
        events.push({ kind: 'interrupt', ts: tsv });
      } else if (pt === 'function_call' || pt === 'local_shell_call' || pt === 'custom_tool_call'
        || pt === 'function_call_output' || pt === 'local_shell_call_output' || pt === 'custom_tool_call_output'
        || pt === 'reasoning') {
        if (probeSkip) continue;
        events.push({ kind: 'tool', ts: tsv });
      } else if (pt === 'message' && p.role === 'user') {
        const t = arrText(p.content).trim();
        if (!t) continue;
        if (BTW_RE.test(t)) { probeSkip = true; continue; } // the user_message twin of the probe
        if (isBoilerplate(t)) continue;
        if (/<turn_aborted/.test(t)) { probeSkip = false; events.push({ kind: 'interrupt', ts: tsv }); continue; }
        probeSkip = false;
        events.push({ kind: 'user', text: t, ts: tsv });
      } else if (pt === 'message' && p.role === 'assistant') {
        if (probeSkip) continue;
        const t = arrText(p.content).trim();
        if (t) events.push({ kind: 'assistant', text: t, ts: tsv });
      }
    }
  }
  let lastAssistantText = '';
  let lastUserText = '';
  let userCount = 0, assistantCount = 0, toolCount = 0;
  let lastActiveMs = null;
  for (const e of events) {
    if (e.kind === 'assistant' && e.text) { lastAssistantText = e.text; assistantCount++; }
    else if (e.kind === 'user') { if (e.text) lastUserText = e.text; userCount++; }
    else if (e.kind === 'tool') toolCount++;
    if (e.ts != null) lastActiveMs = e.ts; // events are in file order; keep the last stamped one
  }
  // Walk back past tool noise to the last conversational event.
  let lastKind = 'unknown';
  for (let i = events.length - 1; i >= 0; i--) {
    const k = events[i].kind;
    if (k === 'tool') continue;
    lastKind = k;
    break;
  }
  const res = {
    lastKind,                       // 'user' | 'assistant' | 'interrupt' | 'unknown'
    interrupted: lastKind === 'interrupt',
    inFlight: events.length > 0 && events[events.length - 1].kind === 'tool',
    // keep the END of the message: the ask, if any, lives in the tail
    lastAssistantText: String(lastAssistantText).slice(-4000),
    lastUserText: String(lastUserText).slice(-500),
    lastActiveMs,
    userCount,
    assistantCount,
    toolCount,
    wholeFile,
    // depth estimate: substantive messages seen in the slice, scaled up when the
    // slice did not cover the whole file. Sort signal only, never displayed.
    msgCountEst: wholeFile || !st ? userCount + assistantCount
      : Math.round((userCount + assistantCount) * (st.size / sliceBytes)),
  };
  needCache.set(ckey, res);
  if (needCache.size > 1500) needCache.clear();
  return res;
}

// The state axis. Returns { state, reason, tier, lastActiveMs, msgCountEst }.
// Notes (blocked / review / done) overlay on top of this in the consumers that
// have them (the renderer); this is the session-content verdict alone.
function deriveNeedState(sig, st, now) {
  const lastActiveMs = sig.lastActiveMs || (st ? st.mtimeMs : now);
  const idleMs = now - lastActiveMs;
  const tier = idleMs <= TIER_HOT_MS ? 'hot' : idleMs <= TIER_DRIFT_MS ? 'drifting' : 'archived';
  const ask = askShapeOf(sig.lastAssistantText);
  let state = 'idle';
  let reason = 'no waiting signal';
  if (sig.interrupted) {
    state = 'need';
    reason = ask ? 'asked, then you interrupted' : 'you interrupted; only you can resume';
  } else if (sig.inFlight && st && now - st.mtimeMs <= FRESH_MS) {
    state = 'work';
    reason = 'tools in flight';
  } else if (sig.lastKind === 'assistant') {
    if (ask) { state = 'need'; reason = ask; }
    else if (doneShapeOf(sig.lastAssistantText)) { state = 'done'; reason = 'reports completion, no ask'; }
    else if (idleMs <= FRESH_MS) { state = 'work'; reason = 'progress report, still fresh'; }
    else { reason = 'ended without an ask'; }
  } else if (sig.lastKind === 'user') {
    if (idleMs <= FRESH_MS) { state = 'work'; reason = 'your turn was picked up'; }
    else if (REPLY_ASK_RE.test(sig.lastUserText || '')) { state = 'need'; reason = 'your reply was never picked up'; }
    else reason = 'waiting on the agent';
  }
  return { state, reason, tier, lastActiveMs, msgCountEst: sig.msgCountEst };
}

// Headless one-shot detection (Claude side; Codex automation is caught by
// isCodexAutomation + the prompt-shape checks in metaFor). A one-shot is a
// tiny fully-visible transcript with at most one genuine user message, no
// follow-up, and no tool activity: the shape of `claude -p` probes, including
// humanctl's own summarizer. The freshness guard keeps a genuinely new
// interactive session visible while it is still plausibly live.
function isClaudeOneShot(sig, st, now) {
  if (!sig.wholeFile) return false;
  if (st && now - st.mtimeMs <= FRESH_MS) return false;
  return sig.userCount <= 1 && sig.assistantCount <= 2 && sig.toolCount === 0 && !sig.interrupted;
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
      const now = Date.now();
      const sig = readNeedSignals(file, h.name, st);
      // Claude-side noise filter: headless one-shots (summarizer probes,
      // `claude -p`) are automation, not an interactive session waiting on you.
      if (h.name === 'claude-code' && !includeAutomation && isClaudeOneShot(sig, st, now)) continue;
      const need = deriveNeedState(sig, st, now);
      rows.push({
        harness: h.name,
        id: path.basename(file).replace(/\.jsonl$/, ''),
        cwd,
        repo: cwd ? cwd.replace(HOME, '~') : '',
        title: title || '',
        customTitle: customTitle || '',
        lastRole: lastRole(file, h.name, st),
        state: need.state,          // 'need' | 'work' | 'done' | 'idle' (content-shaped)
        stateReason: need.reason,   // honest label for the state, surfaced in the UI
        tier: need.tier,            // 'hot' | 'drifting' | 'archived'
        lastActiveMs: need.lastActiveMs, // last substantive event, not mtime
        msgCountEst: need.msgCountEst,
        ageMs: st.mtimeMs,
        age: relAge(need.lastActiveMs), // displayed age follows real conversation, not mtime
        sizeBytes: st.size,
        path: file,
      });
    }
  }
  // Display order: tier first, then needs-you, then session depth, then
  // recency. Depth and recency weights follow the resume-mining odds ratios
  // (depth 2.23 > age 1.82 > question-tail 1.46).
  const TIER_RANK = { hot: 0, drifting: 1, archived: 2 };
  rows.sort((a, b) => b.ageMs - a.ageMs);
  const out = rows.slice(0, limit);
  out.sort((a, b) =>
    (TIER_RANK[a.tier] - TIER_RANK[b.tier])
    || ((a.state === 'need' ? 0 : 1) - (b.state === 'need' ? 0 : 1))
    || ((b.msgCountEst || 0) - (a.msgCountEst || 0))
    || (b.lastActiveMs - a.lastActiveMs));
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

// Attention tiers (the time axis), measured from the last SUBSTANTIVE event's
// own timestamp, never file mtime (metadata appends refresh mtime on dead
// threads). Windows validated by resume-pattern mining over the full local
// session history (2026-07): a session idle a full day still has roughly a
// 1-in-3 chance of ever being picked up, but near-term actionability collapses
// past 24h, and past 7 days only ~6% ever return.
//   hot      < 24h : full-strength display
//   drifting 24h-7d: still listed, visually secondary
//   archived > 7d  : out of default views (the Wall keeps it)
// These constants are the single source: the renderer consumes the tier the
// reader computed per row and owns no time constants of its own.
const TIER_HOT_MS = 24 * 60 * 60 * 1000;
const TIER_DRIFT_MS = 7 * 24 * 60 * 60 * 1000;
// "working" freshness window: how recently a session must have moved for a
// user-last turn or a progress-shaped tail to count as actively worked.
const FRESH_MS = 30 * 60 * 1000;
// Back-compat alias: lib/pulse.js gates open notes and waiting sessions on
// this. It now equals the hot tier (the mining moved it from 18h to 24h).
const NEED_DECAY_MS = TIER_HOT_MS;

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
    // Content-shaped counts: needs-you means the tail actually asks for you
    // (or was interrupted), within the hot or drifting tier. Archived sessions
    // are out of the default views and out of these counts.
    needsYou: rows.filter((r) => r.state === 'need' && r.tier !== 'archived').length,
    working: rows.filter((r) => r.state === 'work' && r.tier !== 'archived').length,
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

// --- Issue-key extraction (the pulse join token) ------------------------------
// The one join key across work sources (git branches, worktree paths, PR
// title/body/headRef, session transcripts) is the issue-key token: two or more
// letters, a dash, digits (TEAM-123). Case-insensitive in the wild, normalized
// to uppercase here. Shared by the desktop and `humanctl pulse`; keep the two
// surfaces on this one extractor. See docs/pulse.md.
const ISSUE_KEY_RE = /\b([A-Za-z]{2,})-(\d+)\b/g;

function extractIssueKeys(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  for (const m of String(text).matchAll(ISSUE_KEY_RE)) {
    const key = `${m[1].toUpperCase()}-${m[2]}`;
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

// Per-session issue refs for pulse: Linear URLs (same extraction as
// readDetail's collectLinear) plus bare issue-key tokens, read from bounded
// head+tail slices, never the full transcript. Bare tokens over raw transcript
// text are noisy (UTF-8, ISO-8601, and uuid fragments match the shape), so
// consumers must corroborate them against known issues or branches before
// treating them as joins. Cached by (path, mtime, size).
const issueRefCache = new Map();
function readIssueRefs(file) {
  let st; try { st = fs.statSync(file); } catch { return { keys: [], urls: [] }; }
  const ckey = `${file}:${st.mtimeMs}:${st.size}`;
  if (issueRefCache.has(ckey)) return issueRefCache.get(ckey);
  const text = readSlice(file, HEAD_BYTES, false) + '\n' + readSlice(file, TAIL_BYTES, true);
  const linear = new Map();
  collectLinear(text, linear);
  const keys = new Set();
  for (const ref of linear.values()) {
    const im = ref.url.match(/\/issue\/([A-Za-z]{2,}-\d+)/i);
    if (im) keys.add(im[1].toUpperCase());
  }
  for (const k of extractIssueKeys(text)) keys.add(k);
  const res = { keys: [...keys], urls: [...linear.values()].slice(0, 16) };
  issueRefCache.set(ckey, res);
  if (issueRefCache.size > 800) issueRefCache.clear();
  return res;
}

// --- Work-reference evidence scan (the pulse session join) --------------------
// Sessions are often launched from a parent directory (the workspace root)
// while the agent works inside a child repo or worktree via `git -C` and
// absolute paths. cwd alone cannot join those sessions, but the transcript
// tail names the paths and branches the agent actually touched. This scan is
// bounded (tail slice only, capped match count), read-only, and vocabulary
// driven: the caller supplies the roots (repo and worktree paths) and tokens
// (branch names) it knows about, and gets back only the subset the transcript
// mentions. Raw paths outside the vocabulary are never returned, so noise in
// the transcript cannot fabricate a reference. Cached by (path, mtime, size,
// vocabulary signature).
const PATH_TOKEN_RE = /(?:\/[A-Za-z0-9._~@+-]+){2,}/g;
const WORKREF_MATCH_CAP = 4000; // path-shaped tokens scanned per transcript
const workRefCache = new Map();
const tokenRegexCache = new Map();

function vocabSig(list) {
  let h = 5381;
  const s = list.join('\n');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${list.length}:${h}`;
}

function tokenRegexFor(tokens, sig) {
  if (tokenRegexCache.has(sig)) return tokenRegexCache.get(sig);
  let re = null;
  if (tokens.length) {
    const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    re = new RegExp(`(?:${escaped.join('|')})`, 'g');
  }
  tokenRegexCache.set(sig, re);
  if (tokenRegexCache.size > 20) tokenRegexCache.clear();
  return re;
}

function readWorkRefs(file, opts = {}) {
  const roots = opts.roots || [];
  const tokens = opts.tokens || [];
  let st; try { st = fs.statSync(file); } catch { return { roots: [], tokens: [] }; }
  const sig = `${vocabSig(roots)}|${vocabSig(tokens)}`;
  const ckey = `${file}:${st.mtimeMs}:${st.size}:${sig}`;
  if (workRefCache.has(ckey)) return workRefCache.get(ckey);
  const text = readSlice(file, TAIL_BYTES, true);
  const rootSet = new Set(roots);
  const matchedRoots = new Set();
  const seen = new Set();
  let scanned = 0;
  for (const m of text.matchAll(PATH_TOKEN_RE)) {
    if (++scanned > WORKREF_MATCH_CAP) break;
    let p = m[0];
    if (seen.has(p)) continue;
    seen.add(p);
    // Walk up the ancestor chain: the deepest configured root containing this
    // path is the reference (a path inside a worktree names that worktree).
    while (p.length > 1) {
      if (rootSet.has(p)) { matchedRoots.add(p); break; }
      const cut = p.lastIndexOf('/');
      if (cut <= 0) break;
      p = p.slice(0, cut);
    }
  }
  const matchedTokens = new Set();
  const re = tokenRegexFor(tokens, vocabSig(tokens));
  if (re) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      matchedTokens.add(m[0]);
      if (matchedTokens.size >= 32) break;
    }
  }
  const res = { roots: [...matchedRoots], tokens: [...matchedTokens] };
  workRefCache.set(ckey, res);
  if (workRefCache.size > 800) workRefCache.clear();
  return res;
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

module.exports = {
  listRecent, readBlocks, readUsage, readRowExtras, readDetail, aggregateSkills,
  accountStatus, readNotes, extractIssueKeys, readIssueRefs, readWorkRefs,
  readNeedSignals, deriveNeedState, askShapeOf, doneShapeOf, isClaudeOneShot,
  ISSUE_KEY_RE, NOTES_FILE, HARNESSES, KINDS, BTW_SENTINEL,
  NEED_DECAY_MS, TIER_HOT_MS, TIER_DRIFT_MS, FRESH_MS,
};

// CLI smoke: `node lib/sessions.js` prints a quick table (read-only).
if (require.main === module) {
  const rows = listRecent({ maxAgeH: 72, limit: 15 });
  console.log(`recent sessions: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `${r.age.padStart(4)}  ${r.harness.padEnd(11)}  ${r.state.padEnd(4)}  ${r.tier.padEnd(8)}  ${(r.repo || '?').slice(0, 28).padEnd(28)}  ${(r.id).slice(0, 10)}  ${(r.stateReason || '').slice(0, 34).padEnd(34)}  ${r.title.slice(0, 40)}`
    );
  }
}
