// Cross-harness session reader shared by the humanctl desktop app and CLI.
// Read-only. Scans local Codex + Claude Code session transcripts and returns
// recent-session metadata. Never writes, never transmits. Huge transcripts are
// read by bounded head/tail slices, never fully loaded.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { priceFor, contextWindowFor, AS_OF } from './pricing';

export type Harness = 'codex' | 'claude-code';
export type SessionState = 'need' | 'work' | 'done' | 'idle' | 'block';
export type SessionTier = 'hot' | 'drifting' | 'archived';

// HOME is resolved PER CALL, never frozen at require time. A module-load
// `const HOME = os.homedir()` bakes the real home into every derived path for
// the life of the process, so a selftest that swaps `process.env.HOME` after
// the first import cannot sandbox this reader and ends up scanning (and, via
// readNotes, reporting on) the developer's real ~/.codex, ~/.claude, and
// ~/.humanctl. Same pattern as controlDir() in commands.ts.
function home(): string { return process.env.HOME || os.homedir(); }
function harnesses(): { name: Harness; dir: string }[] {
  const h = home();
  return [
    { name: 'codex', dir: path.join(h, '.codex', 'sessions') },
    { name: 'claude-code', dir: path.join(h, '.claude', 'projects') },
  ];
}

const HEAD_BYTES = 256 * 1024; // enough for session meta + first real prompt
const TAIL_BYTES = 128 * 1024; // enough for current state

// Codex stores rollouts under sessions/YYYY/MM/DD. When a minYear is given we
// skip whole year directories older than it: a file modified within the recency
// window cannot live in a year before the cutoff's year (true even across a
// new-year boundary, since minYear is the cutoff's own year). This avoids
// statting thousands of archived transcripts on every scan. Safe for Claude too,
// whose project dirs are never named as bare 4-digit years.
function walkJsonl(dir: string, out: string[], minYear?: number): void {
  let ents: fs.Dirent[];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (minYear && /^\d{4}$/.test(e.name) && +e.name < minYear) continue; // skip archived years
      walkJsonl(p, out, minYear);
    } else if (e.name.endsWith('.jsonl')) out.push(p);
  }
}

function readSlice(file: string, bytes: number, fromEnd: boolean): string {
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

const parse = (line: string): Record<string, any> | null => { try { return JSON.parse(line); } catch { return null; } };

// "Ask the session" probes prefix their injected user turn with this sentinel.
// Claude asks run with --no-session-persistence and write nothing, but Codex
// asks always append into the real rollout (and a future Claude fork path
// would persist too), so persisted probe turns must read as non-substantive:
// never a title, never lastUserText, never a state flip. See docs/ask-session.md.
export const BTW_SENTINEL = '[humanctl btw]';
const BTW_RE = /^\[humanctl btw\]/;

function isBoilerplate(t: string | null | undefined): boolean {
  if (!t) return true;
  return /^# AGENTS\.md|^<INSTRUCTIONS|^<skill|^<environment_context|^<subagent|^<turn_aborted|^<channel|^<local-command|^<task-notification|^<command-message|^<command-name|^<system-reminder|^This session is being continued|^Caveat: The messages below|^\[Request interrupted|^\[Request\]|^\[humanctl btw\]/.test(t);
}

function textOf(content: unknown, claude: boolean): string {
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
// in metaFor. bin/humanctl.ts span mirrors these semantics; keep them in sync.
function isCodexAutomation(meta: Record<string, any> | null | undefined): boolean {
  if (!meta) return false;
  if (meta.parent_thread_id) return true;
  if (meta.agent_role || meta.agent_nickname) return true;
  if (meta.source && typeof meta.source === 'object' && meta.source.subagent) return true;
  if (meta.originator === 'codex_exec' || meta.source === 'exec') return true;
  if (meta.thread_source === 'subagent' || meta.thread_source === 'automation') return true;
  return false;
}

interface MetaResult {
  cwd: string;
  title: string;
  customTitle: string;
  automation: boolean;
}

// metaFor + lastRole each read a slice of every recent file on every scan.
// They only change when the file changes, so memoize by (path, mtime, size).
// This is what keeps the main thread from re-parsing ~1300 transcripts per tick.
const metaCache = new Map<string, MetaResult>();
const roleCache = new Map<string, string>();

function metaFor(file: string, harness: Harness, st?: fs.Stats | null): MetaResult {
  if (st === undefined) { try { st = fs.statSync(file); } catch { st = null; } }
  const ckey = st ? `${file}:${st.mtimeMs}:${st.size}` : file;
  const cached = metaCache.get(ckey);
  if (cached) return cached;
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
  const res: MetaResult = { cwd, title, customTitle, automation };
  metaCache.set(ckey, res);
  if (metaCache.size > 1500) metaCache.clear();
  return res;
}

function lastRole(file: string, harness: Harness, st?: fs.Stats | null): string {
  if (st === undefined) { try { st = fs.statSync(file); } catch { st = null; } }
  const ckey = st ? `${file}:${st.mtimeMs}:${st.size}` : file;
  const cached = roleCache.get(ckey);
  if (cached !== undefined) return cached;
  const tail = readSlice(file, TAIL_BYTES, true).split('\n').map(parse).filter(Boolean) as Record<string, any>[];
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
const ASK_STRONG: [RegExp, string][] = [
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
const ASK_SOFT: [RegExp, string][] = [
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

function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf('.', index), text.lastIndexOf('!', index), text.lastIndexOf('?', index), text.lastIndexOf('\n', index)) + 1;
  return text.slice(start, index);
}
function matchAsk(list: [RegExp, string][], text: string): string | null {
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
export function askShapeOf(text: string | null | undefined): string | null {
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
export function doneShapeOf(text: string | null | undefined): boolean {
  if (!text) return false;
  return DONE_RE.test(String(text).trim().slice(-DONE_WINDOW));
}

// Read the tail of a transcript into normalized substantive events and derive
// the obligation signals. Metadata lines (pr-link, mode, custom-title,
// last-prompt, permission-mode, queue-operation, attachments) and local
// commands (/model, /effort) are excluded from both the event stream and the
// last-activity timestamp: an appended footer must never make a dead thread
// look alive, and a trailing /model must never mask a pending assistant ask.
const NEED_TAIL_BYTES: Record<'claude-code' | 'codex', number> = { 'claude-code': 512 * 1024, codex: 3 * 1024 * 1024 };

export interface NeedSignals {
  lastKind: 'user' | 'assistant' | 'interrupt' | 'unknown';
  interrupted: boolean;
  inFlight: boolean;
  lastAssistantText: string;
  lastUserText: string;
  lastActiveMs: number | null;
  userCount: number;
  assistantCount: number;
  toolCount: number;
  wholeFile: boolean;
  msgCountEst: number;
}

const needCache = new Map<string, NeedSignals>();
const INTERRUPT_RE = /^\[Request interrupted by user/;

type TlEvent = { kind: 'user' | 'assistant' | 'tool' | 'interrupt'; text?: string; ts: number | null };

export function readNeedSignals(file: string, harness: Harness | string, st?: fs.Stats | null): NeedSignals {
  if (st === undefined) { try { st = fs.statSync(file); } catch { st = null; } }
  const ckey = st ? `${file}:${st.mtimeMs}:${st.size}` : file;
  const cached = needCache.get(ckey);
  if (cached) return cached;
  const claude = harness === 'claude-code' || file.includes('/.claude/');
  const sliceBytes = NEED_TAIL_BYTES[claude ? 'claude-code' : 'codex'];
  const wholeFile = !st || st.size <= sliceBytes;
  const lines = readSlice(file, sliceBytes, true).split('\n');
  if (!wholeFile && lines.length) lines.shift(); // drop the possibly-partial first tail line
  const events: TlEvent[] = [];
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
        if (Array.isArray(m.content) && m.content.some((x: any) => x && x.type === 'tool_result')) { if (!probeSkip) events.push({ kind: 'tool', ts: tsv }); continue; }
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
        if (Array.isArray(m.content) && m.content.some((x: any) => x && x.type === 'tool_use')) events.push({ kind: 'tool', ts: tsv });
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
  let lastActiveMs: number | null = null;
  for (const e of events) {
    if (e.kind === 'assistant' && e.text) { lastAssistantText = e.text; assistantCount++; }
    else if (e.kind === 'user') { if (e.text) lastUserText = e.text; userCount++; }
    else if (e.kind === 'tool') toolCount++;
    if (e.ts != null) lastActiveMs = e.ts; // events are in file order; keep the last stamped one
  }
  // Walk back past tool noise to the last conversational event.
  let lastKind: NeedSignals['lastKind'] = 'unknown';
  for (let i = events.length - 1; i >= 0; i--) {
    const k = events[i].kind;
    if (k === 'tool') continue;
    lastKind = k;
    break;
  }
  const res: NeedSignals = {
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

export interface NeedDerivation {
  state: SessionState;
  reason: string;
  tier: SessionTier;
  lastActiveMs: number;
  msgCountEst: number;
}

// The state axis. Returns { state, reason, tier, lastActiveMs, msgCountEst }.
// Notes (blocked / review / done) overlay on top of this in the consumers that
// have them (the renderer); this is the session-content verdict alone.
export function deriveNeedState(sig: NeedSignals, st: fs.Stats | null | undefined, now: number): NeedDerivation {
  const lastActiveMs = sig.lastActiveMs || (st ? st.mtimeMs : now);
  const idleMs = now - lastActiveMs;
  const tier: SessionTier = idleMs <= TIER_HOT_MS ? 'hot' : idleMs <= TIER_DRIFT_MS ? 'drifting' : 'archived';
  const ask = askShapeOf(sig.lastAssistantText);
  let state: SessionState = 'idle';
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
export function isClaudeOneShot(sig: NeedSignals, st: fs.Stats | null | undefined, now: number): boolean {
  if (!sig.wholeFile) return false;
  if (st && now - st.mtimeMs <= FRESH_MS) return false;
  return sig.userCount <= 1 && sig.assistantCount <= 2 && sig.toolCount === 0 && !sig.interrupted;
}

function relAge(ms: number): string {
  const h = (Date.now() - ms) / 3.6e6;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm';
  if (h < 48) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}

export interface SessionRow {
  harness: Harness;
  id: string;
  cwd: string;
  repo: string;
  title: string;
  customTitle: string;
  lastRole: string;
  state: SessionState;
  stateReason: string;
  tier: SessionTier;
  lastActiveMs: number;
  msgCountEst: number;
  ageMs: number;
  age: string;
  sizeBytes: number;
  path: string;
  // enriched fields (withUsage: true)
  contextPct?: number | null;
  costUSD?: number | null;
  apiEquivUSD?: number | null;
  totalTokens?: number;
  lastUser?: string;
  prevAgent?: string;
  reasoningEffort?: string | null;
  ultracode?: boolean;
  model?: string;
  inScope?: boolean;
  ancestorScope?: boolean;
  issueKeys?: string[];
  workRefs?: { roots: string[]; tokens: string[] };
  _uuid?: string;
}

export interface ListRecentOpts {
  maxAgeH?: number;
  limit?: number;
  withUsage?: boolean;
  includeAutomation?: boolean;
}

// The tree walk + per-file meta/role reads are the expensive part, and are
// identical whether or not usage is requested. Cache the base row list for a
// short window so listSessions + getStatus in the same refresh pay it once, not
// twice. Per-file work underneath is already mtime-memoized (metaCache/roleCache).
const scanCache = new Map<string, { at: number; rows: SessionRow[] }>();
const SCAN_TTL_MS = 1500;
function baseScan(maxAgeH: number, limit: number, includeAutomation?: boolean): SessionRow[] {
  // The resolved home is part of the key: without it a HOME swap inside the TTL
  // window would be served rows scanned from the PREVIOUS home.
  const h0 = home();
  const key = `${h0}:${maxAgeH}:${limit}:${!!includeAutomation}`;
  const hit = scanCache.get(key);
  if (hit && Date.now() - hit.at < SCAN_TTL_MS) return hit.rows;
  const cutoff = Date.now() - maxAgeH * 3.6e6;
  const minYear = new Date(cutoff).getFullYear();
  const rows: SessionRow[] = [];
  for (const h of harnesses()) {
    const files: string[] = [];
    walkJsonl(h.dir, files, minYear);
    for (const file of files) {
      if (file.includes('/subagents/') || file.includes('/workflows/')) continue; // child agents
      let st: fs.Stats;
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
        repo: cwd ? cwd.replace(h0, '~') : '',
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
  const TIER_RANK: Record<SessionTier, number> = { hot: 0, drifting: 1, archived: 2 };
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
function codexStateDb(): string { return path.join(home(), '.codex', 'state_5.sqlite'); }
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const codexTitleCache = new Map<string, string>(); // `${uuid}:${dbMtime}` -> title ('' if none)
function applyCodexTitles(rows: SessionRow[]): void {
  const db = codexStateDb();
  let dbm: number;
  try { dbm = fs.statSync(db).mtimeMs; } catch { return; }
  const need: string[] = [];
  for (const r of rows) {
    const m = String(r.id).match(UUID_RE);
    if (!m) continue;
    r._uuid = m[1];
    const k = `${r._uuid}:${dbm}`;
    if (codexTitleCache.has(k)) { const v = codexTitleCache.get(k); if (v) r.customTitle = v; }
    else need.push(r._uuid);
  }
  if (!need.length) return;
  let qrows: { id: string; title: string }[] = [];
  try {
    const inList = need.map((u) => `'${u}'`).join(','); // uuids are hex, safe to inline
    const raw = execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', db,
      `SELECT id, title FROM threads WHERE id IN (${inList}) AND title != ''`],
      { timeout: 4000, encoding: 'utf8', maxBuffer: 8 << 20 });
    qrows = raw.trim() ? JSON.parse(raw) : [];
  } catch { qrows = []; }
  const found: Record<string, string> = {};
  for (const q of qrows) { const t = String(q.title || '').replace(/\s+/g, ' ').trim().slice(0, 120); if (t) found[q.id] = t; }
  for (const u of need) codexTitleCache.set(`${u}:${dbm}`, found[u] || '');
  for (const r of rows) if (r._uuid && found[r._uuid]) r.customTitle = found[r._uuid];
  if (codexTitleCache.size > 3000) codexTitleCache.clear();
}

// Public: recent top-level sessions across harnesses (excludes subagent/workflow children).
export function listRecent(opts: ListRecentOpts = {}): SessionRow[] {
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

// Bounded read for the heavy per-session readers (blocks, detail). Token usage
// is NOT one of them: it needs every line, and gets there incrementally through
// the per-file cursor in readClaudeUsage.
// Files over the cap are read TAIL-ANCHORED (the newest 12MB), never the head:
// the head of a 30MB transcript is typically a day old, and a 2026-07 audit of
// live sessions found head-anchored reads rendering timelines up to 22h stale
// with 150+ substantive events silently missing. Every consumer that can hit
// the cap reports the cut explicitly (truncated + skippedHeadBytes).
const MAX_READ = 12 * 1024 * 1024;
const MAX_BLOCKS = 4000; // keep the DOM sane on very long sessions
export const KINDS = ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'meta'] as const;
export type BlockKind = typeof KINDS[number];

const estTokens = (s: string | null | undefined) => Math.max(1, Math.ceil((s || '').length / 4));
const previewOf = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 120);

function arrText(content: unknown): string {
  if (Array.isArray(content)) return content.map((x) => (x && (x.text || x.thinking)) || '').join(' ');
  return typeof content === 'string' ? content : '';
}

interface RawBlock { kind: string; text: string }

// Return an array of {kind, text} for one transcript line (may be empty).
function blocksForLine(o: Record<string, any>, claude: boolean): RawBlock[] {
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
    const out: RawBlock[] = [];
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

export interface SessionBlock {
  kind: BlockKind;
  tokens: number;
  preview: string;
}

export interface ReadBlocksResult {
  id: string;
  harness: Harness | string;
  blocks: SessionBlock[];
  truncated: boolean;
  skippedHeadBytes: number;
}

export function readBlocks(file: string, opts: { harness?: Harness | string } = {}): ReadBlocksResult {
  const harness = opts.harness || (file.includes('/.claude/') ? 'claude-code' : 'codex');
  const claude = harness === 'claude-code';
  let size = 0;
  try { size = fs.statSync(file).size; } catch { /* size stays 0 */ }
  const fromEnd = size > MAX_READ;
  const lines = readSlice(file, MAX_READ, fromEnd).split('\n');
  if (fromEnd && lines.length) lines.shift(); // drop the partial first line of a tail slice
  const blocks: SessionBlock[] = [];
  for (const ln of lines) {
    if (!ln) continue;
    const o = parse(ln);
    if (!o) continue;
    for (const b of blocksForLine(o, claude)) {
      if (!b.text) continue;
      blocks.push({ kind: (KINDS as readonly string[]).includes(b.kind) ? (b.kind as BlockKind) : 'meta', tokens: estTokens(b.text), preview: previewOf(b.text) });
    }
  }
  let truncated = fromEnd;
  // When the block cap trims, keep the NEWEST blocks: the tail is the live part.
  if (blocks.length > MAX_BLOCKS) { blocks.splice(0, blocks.length - MAX_BLOCKS); truncated = true; }
  return {
    id: path.basename(file).replace(/\.jsonl$/, ''), harness, blocks, truncated,
    skippedHeadBytes: fromEnd ? size - MAX_READ : 0,
  };
}

// --- Live timeline: bounded backward pages + incremental forward appends ------
// The dossier timeline was previously derived from head-anchored bounded reads,
// which silently spliced a stale mid-file tail into the UI on transcripts past
// the cap. These readers make both directions honest:
//   readTimelinePage  walks BACKWARD from a line-aligned offset, budgeted by
//                     SUBSTANTIVE events (user/assistant/interrupt), not raw
//                     bytes: tool_result lines are 56-80% of tail bytes in the
//                     wild and starve any byte budget. Every page reports its
//                     exact [start, end) byte coverage, whether it reached the
//                     start of the file, and a density-based estimate of the
//                     earlier events it does not show. The UI renders every cut
//                     as an explicit "load older" element, never a spliced
//                     timeline pretending to be complete.
//   readAppended      reads FORWARD from a per-file cursor: only the bytes
//                     appended since the last read. Transcripts are append-only,
//                     so this is what keeps an open dossier live without
//                     re-reading 12MB per fs event. Rotation and truncation are
//                     never papered over: an inode change or a size shrink
//                     returns {reset:true} and the caller re-reads a full page.
// All offset math is done on BYTES (buffers), never string indices: transcripts
// are full of multibyte UTF-8 and a char-indexed cursor would drift. A '\n'
// byte (0x0a) can never appear inside a multibyte UTF-8 sequence, so slicing at
// newline bytes is always codepoint-safe.

const TL_CHUNK = 1024 * 1024;               // backward read unit
const TL_PAGE_MAX_BYTES = 6 * 1024 * 1024;  // hard scan cap per page request
const TL_PAGE_EVENTS = 30;                  // substantive events per page target
const TL_PREVIEW_CHARS = 240;
const TL_APPEND_MAX = 8 * 1024 * 1024;      // a bigger delta gets a full re-read

function readBytesRaw(file: string, start: number, len: number): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, start);
    return (n === len ? buf : buf.subarray(0, n)) as Buffer;
  } finally { fs.closeSync(fd); }
}

interface TlMeta {
  customTitle?: string;
  model?: string;
  effort?: string;
}

type TlRawEvent = { k: 'user' | 'assistant' | 'interrupt' | 'probe' | 'tool'; t?: string; ts: number | null };

// One parsed transcript line -> raw timeline events. Substantive semantics
// mirror readNeedSignals (boilerplate filtered, ask-the-session probes marked
// for the forward pass, tool activity kept as countable noise); previews and
// per-event timestamps are kept for display. Claude custom-title lines and
// Codex turn_context markers surface through `meta`, never as events, so a
// rename or a model switch in appended bytes is still picked up.
function tlEventsForLine(o: Record<string, any>, claude: boolean, meta: TlMeta): TlRawEvent[] {
  const ts0 = o.timestamp ? Date.parse(o.timestamp) : NaN;
  const ts = Number.isFinite(ts0) ? ts0 : null;
  const out: TlRawEvent[] = [];
  if (claude) {
    if (o.type === 'custom-title' && o.customTitle && meta) meta.customTitle = String(o.customTitle);
    const m = o.message;
    if (!m || !m.role) return out;
    if (m.model && meta) meta.model = m.model;
    if (m.role === 'user') {
      if (Array.isArray(m.content) && m.content.some((x: any) => x && x.type === 'tool_result')) { out.push({ k: 'tool', ts }); return out; }
      const t = genuineUserText(m.content).trim();
      if (!t) return out;
      if (INTERRUPT_RE.test(t)) { out.push({ k: 'interrupt', ts }); return out; }
      if (BTW_RE.test(t)) { out.push({ k: 'probe', ts }); return out; }
      if (isBoilerplate(t)) return out;
      out.push({ k: 'user', t: clip(t, TL_PREVIEW_CHARS), ts });
    } else if (m.role === 'assistant') {
      const t = assistantText(m.content).trim();
      if (t) out.push({ k: 'assistant', t: clip(t, TL_PREVIEW_CHARS), ts });
      if (Array.isArray(m.content) && m.content.some((x: any) => x && x.type === 'tool_use')) out.push({ k: 'tool', ts });
    }
    return out;
  }
  // codex rollout
  if (o.type === 'turn_context') {
    const tc = o.payload || {};
    if (meta) { if (tc.model) meta.model = tc.model; if (tc.effort) meta.effort = tc.effort; }
    return out;
  }
  const p = o.payload || o;
  const pt = p.type || o.type;
  if (pt === 'user_message' && p.message) {
    const t = String(p.message).trim();
    if (/<turn_aborted/.test(t)) { out.push({ k: 'interrupt', ts }); return out; }
    if (!t) return out;
    if (BTW_RE.test(t)) { out.push({ k: 'probe', ts }); return out; }
    if (isBoilerplate(t)) return out;
    out.push({ k: 'user', t: clip(t, TL_PREVIEW_CHARS), ts });
  } else if (pt === 'agent_message' && p.message) {
    const t = String(p.message).trim();
    if (t) out.push({ k: 'assistant', t: clip(t, TL_PREVIEW_CHARS), ts });
  } else if (pt === 'turn_aborted') {
    out.push({ k: 'interrupt', ts });
  } else if (pt === 'function_call' || pt === 'local_shell_call' || pt === 'custom_tool_call'
    || pt === 'function_call_output' || pt === 'local_shell_call_output' || pt === 'custom_tool_call_output'
    || pt === 'reasoning') {
    out.push({ k: 'tool', ts });
  } else if (pt === 'message' && (p.role === 'user' || p.role === 'assistant')) {
    const t = arrText(p.content).trim();
    if (!t) return out;
    if (p.role === 'user') {
      if (BTW_RE.test(t)) { out.push({ k: 'probe', ts }); return out; }
      if (isBoilerplate(t)) return out;
      if (/<turn_aborted/.test(t)) { out.push({ k: 'interrupt', ts }); return out; }
      out.push({ k: 'user', t: clip(t, TL_PREVIEW_CHARS), ts });
    } else out.push({ k: 'assistant', t: clip(t, TL_PREVIEW_CHARS), ts });
  }
  return out;
}

function tlParseText(text: string, claude: boolean, meta: TlMeta): TlRawEvent[] {
  const raw: TlRawEvent[] = [];
  for (const ln of text.split('\n')) {
    if (!ln) continue;
    const o = parse(ln);
    if (!o) continue;
    for (const e of tlEventsForLine(o, claude, meta)) raw.push(e);
  }
  return raw;
}

export type TimelineEvent = { k: 'user' | 'assistant' | 'interrupt'; t?: string; ts: number | null } | { k: 'tools'; n: number; ts: number | null };

// Forward pass over raw events: drop persisted ask-the-session probe turns
// (question plus the answer it produced, same window rule as readNeedSignals),
// then collapse runs of tool events into single countable markers so tool
// noise can never crowd real messages out of a page. `probe0` threads the
// probe-skip window across appends (a probe's question and its answer can land
// in different append batches).
function tlFinalize(raw: TlRawEvent[], probe0: boolean): { events: TimelineEvent[]; substantive: number; probe: boolean } {
  const events: TimelineEvent[] = [];
  let probeSkip = !!probe0;
  let substantive = 0;
  for (const e of raw) {
    if (e.k === 'probe') { probeSkip = true; continue; }
    if (e.k === 'user' || e.k === 'interrupt') probeSkip = false;
    if (probeSkip) continue;
    if (e.k === 'tool') {
      const last = events[events.length - 1];
      if (last && last.k === 'tools') { last.n++; if (e.ts != null) last.ts = e.ts; }
      else events.push({ k: 'tools', n: 1, ts: e.ts });
      continue;
    }
    events.push(e as TimelineEvent);
    substantive++;
  }
  return { events, substantive, probe: probeSkip };
}

export interface TimelinePage {
  harness: Harness | string;
  events: TimelineEvent[];
  start: number;
  end: number;
  size: number;
  mtimeMs: number;
  atStart: boolean;
  scannedBytes: number;
  estEarlier: number | null;
  meta: TlMeta | null;
}

export interface ReadTimelinePageOpts {
  harness?: Harness | string;
  chunkBytes?: number;
  maxBytes?: number;
  minEvents?: number;
  before?: number;
}

// A timeline page: substantive-event-budgeted backward read ending at `before`
// (a line-aligned byte offset from a previous page's `start`; omitted = end of
// file, with any partially flushed last line held out so `end` is always
// line-aligned and can seed the append cursor). opts.chunkBytes / maxBytes /
// minEvents exist for the selftest; production uses the TL_ constants.
const tlPageCache = new Map<string, TimelinePage>();
export function readTimelinePage(file: string, opts: ReadTimelinePageOpts = {}): TimelinePage | null {
  const harness = opts.harness || (file.includes('/.claude/') ? 'claude-code' : 'codex');
  const claude = harness === 'claude-code';
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return null; }
  const chunk = opts.chunkBytes || TL_CHUNK;
  const maxBytes = opts.maxBytes || TL_PAGE_MAX_BYTES;
  const target = opts.minEvents || TL_PAGE_EVENTS;
  const before = Number.isFinite(opts.before) ? Math.max(0, Math.min(opts.before as number, st.size)) : null;
  const ckey = `${file}:${st.ino}:${st.mtimeMs}:${st.size}:${before == null ? 'eof' : before}:${chunk}:${maxBytes}:${target}`;
  const cachedPage = tlPageCache.get(ckey);
  if (cachedPage) return cachedPage;

  // Align the end to a line boundary. A `before` from a previous page is
  // already a line start; EOF may cut a partially flushed line, which belongs
  // to the next append, not to this page.
  let alignedEnd = before != null ? before : st.size;
  if (before == null) {
    let probeAt = st.size;
    alignedEnd = 0;
    while (probeAt > 0) {
      const from = Math.max(0, probeAt - chunk);
      const buf = readBytesRaw(file, from, probeAt - from);
      const nl = buf.lastIndexOf(0x0a);
      if (nl >= 0) { alignedEnd = from + nl + 1; break; }
      probeAt = from;
    }
  }

  // Backward scan: read chunks toward the start of the file until the page has
  // enough substantive events, hits the byte cap, or reaches offset 0. A line
  // cut at a chunk boundary is carried and completed by the next (earlier)
  // chunk; if the budget runs out first, the carried partial line is excluded
  // and `start` points at the first FULLY read line, so the next older page
  // re-reads it whole.
  const meta: TlMeta = {};
  let start = alignedEnd;
  let carry: Buffer = Buffer.alloc(0);
  const parts: TlRawEvent[][] = [];
  let scanned = 0, substantive = 0;
  while (start > 0 && scanned < maxBytes && substantive < target) {
    const from = Math.max(0, start - chunk);
    const buf = readBytesRaw(file, from, start - from);
    scanned += buf.length;
    const region = carry.length ? Buffer.concat([buf, carry]) : buf;
    let parseable: Buffer;
    if (from > 0) {
      const nl = region.indexOf(0x0a);
      if (nl < 0) { carry = region; start = from; continue; }
      carry = region.subarray(0, nl + 1) as Buffer;
      parseable = region.subarray(nl + 1) as Buffer;
    } else {
      carry = Buffer.alloc(0);
      parseable = region;
    }
    const raw = tlParseText(parseable.toString('utf8'), claude, meta);
    for (const e of raw) if (e.k === 'user' || e.k === 'assistant' || e.k === 'interrupt') substantive++;
    parts.unshift(raw);
    start = from;
  }
  const pageStart = start + carry.length;
  const { events } = tlFinalize(([] as TlRawEvent[]).concat(...parts), false);
  const covered = Math.max(1, alignedEnd - pageStart);
  const res: TimelinePage = {
    harness,
    events,
    start: pageStart,
    end: alignedEnd,
    size: st.size,
    mtimeMs: st.mtimeMs,
    atStart: pageStart === 0,
    scannedBytes: scanned,
    // Honest density estimate of what the page does NOT show; consumers label
    // it as an estimate ("~"). null when nothing parsed to extrapolate from.
    estEarlier: pageStart === 0 ? 0
      : (substantive > 0 ? Math.max(1, Math.round(substantive * pageStart / covered)) : null),
    meta: Object.keys(meta).length ? meta : null,
  };
  tlPageCache.set(ckey, res);
  if (tlPageCache.size > 120) tlPageCache.clear();
  return res;
}

interface TailCursor {
  ino: number;
  offset: number;
  lastSize: number;
  probe: boolean;
}

// Per-file append cursors for the live (watched) session. The cursor offset is
// always line-aligned: a partially flushed line is left unconsumed and re-read
// once its newline lands. Capped map; priming evicts the oldest entry.
const tailCursors = new Map<string, TailCursor>(); // file -> { ino, offset, lastSize, probe }
const CURSOR_CAP = 32;
export function primeTailCursor(file: string, offset?: number): boolean {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return false; }
  const off = Number.isFinite(offset) ? Math.max(0, Math.min(offset as number, st.size)) : st.size;
  tailCursors.delete(file);
  tailCursors.set(file, { ino: st.ino, offset: off, lastSize: st.size, probe: false });
  if (tailCursors.size > CURSOR_CAP) {
    const oldestKey = tailCursors.keys().next().value;
    if (oldestKey !== undefined) tailCursors.delete(oldestKey);
  }
  return true;
}

export interface ReadAppendedResult {
  reset?: boolean;
  reason?: string;
  size?: number;
  events?: TimelineEvent[];
  meta?: TlMeta | null;
  end?: number;
}

export function readAppended(file: string, opts: { harness?: Harness | string } = {}): ReadAppendedResult {
  const harness = opts.harness || (file.includes('/.claude/') ? 'claude-code' : 'codex');
  const claude = harness === 'claude-code';
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch {
    tailCursors.delete(file);
    return { reset: true, reason: 'missing' };
  }
  const cur = tailCursors.get(file);
  if (!cur) return { reset: true, reason: 'unprimed', size: st.size };
  if (st.ino !== cur.ino || st.size < cur.lastSize || st.size < cur.offset) {
    // Rotation (new inode) or truncation (size shrank): the cursor's history
    // no longer describes this file. Say so; never splice across a rewrite.
    tailCursors.delete(file);
    return { reset: true, reason: st.ino !== cur.ino ? 'rotated' : 'truncated', size: st.size };
  }
  if (st.size - cur.offset > TL_APPEND_MAX) {
    // A huge gap (the app was closed while the session ran) is a re-read, not
    // an incremental parse on the main thread.
    tailCursors.delete(file);
    return { reset: true, reason: 'gap', size: st.size };
  }
  cur.lastSize = st.size;
  if (st.size === cur.offset) return { events: [], meta: null, end: cur.offset, size: st.size };
  const buf = readBytesRaw(file, cur.offset, st.size - cur.offset);
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < 0) return { events: [], meta: null, end: cur.offset, size: st.size }; // partial line only; wait for its newline
  const meta: TlMeta = {};
  const raw = tlParseText(buf.subarray(0, lastNl + 1).toString('utf8'), claude, meta);
  const fin = tlFinalize(raw, cur.probe);
  cur.probe = fin.probe;
  cur.offset += lastNl + 1;
  return { events: fin.events, meta: Object.keys(meta).length ? meta : null, end: cur.offset, size: st.size };
}

// --- Token usage, cost estimate, and quota -----------------------------------
// Real token usage is recorded in both harnesses: Claude per assistant message
// (message.usage + model), Codex in token_count events (cumulative totals +
// live rate limits). We read it, estimate spend from pricing.ts, and surface
// Codex rate limits as a real quota track. Cached by path+mtime+size so live
// refresh does not re-read unchanged files; Claude totals are additionally
// carried forward by a per-file byte cursor, so a changed file re-reads only
// its appended bytes. Read-only.

export interface UsageInfo {
  harness: Harness | string;
  model: string;
  metered: boolean;
  costUSD: number | null;
  apiEquivUSD: number | null;
  rateLimits: unknown;
  contextWindow?: number | null;
  contextTokens?: number;
  contextPct?: number | null;
  tokens: { input?: number; output?: number; cacheRead?: number; cacheCreate?: number; cached?: number; reasoning?: number; total: number };
}

const usageCache = new Map<string, UsageInfo>();

// Claude records usage per assistant message, so an honest whole-session total
// needs every line of the transcript. Any single-ended bounded read undercounts
// the moment the file outgrows the cap: a 30MB transcript read tail-anchored at
// MAX_READ contributed only its newest 12MB to `tokens` and `costUSD`, silently
// and always low. Transcripts are append-only, so the fix has the same shape as
// the timeline tail cursors above: fold the whole file into running sums once,
// then extend those sums by exactly the appended bytes on every later call.
//
// Two invariants make that safe:
//   - Offsets are line-aligned BYTES. A partially flushed trailing line is left
//     unconsumed and carried into the next read, so a line is never counted as
//     two halves. ('\n' = 0x0a can never appear inside a multibyte UTF-8
//     sequence, so slicing at newline bytes is codepoint-safe.)
//   - An inode change (rotation) or a size shrink (truncation) means the sums no
//     longer describe the file. They are discarded and the file is re-scanned
//     from byte 0.
//
// Cost is accumulated into PER-MODEL buckets and priced bucket by bucket at the
// end. The old code kept only the last model seen and priced the entire session
// at that rate, so a session that ran Opus and then switched to Haiku was billed
// end to end at Haiku's rate (and vice versa). A whole session is never priced
// at one model again.
//
// The cursor map lives in whatever process owns the reader. In the desktop app
// that is the long-lived reader-service utilityProcess, so cursors survive the
// renderer's 20s poll and each poll re-reads only the appended bytes. A reader
// respawn simply re-scans from 0, which is correct, just not free.
const USAGE_CHUNK = 4 * 1024 * 1024;   // forward read unit
const USAGE_CURSOR_CAP = 128;          // LRU bound on tracked files

interface UsageBucket { inT: number; out: number; cr: number; cc: number }
interface UsageCursor {
  ino: number;
  offset: number;    // line-aligned byte offset already folded into byModel
  lastSize: number;
  model: string;     // model in effect at `offset`, carried across chunks and calls
  lastCtx: number;
  byModel: Map<string, UsageBucket>;
}
const usageCursors = new Map<string, UsageCursor>(); // file -> cursor (insertion-ordered = LRU)

function bucketFor(cur: UsageCursor, model: string): UsageBucket {
  let b = cur.byModel.get(model);
  if (!b) { b = { inT: 0, out: 0, cr: 0, cc: 0 }; cur.byModel.set(model, b); }
  return b;
}

// Forward, chunked, line-aligned scan of [cur.offset, end): parses the complete
// lines only, folds them into the cursor's per-model sums, and advances
// cur.offset to the byte after the last consumed newline.
function usageScanForward(file: string, cur: UsageCursor, end: number, chunkBytes?: number): void {
  const chunk = chunkBytes || USAGE_CHUNK;
  let pos = cur.offset;
  let carry: Buffer = Buffer.alloc(0);
  while (pos < end) {
    const want = Math.min(chunk, end - pos);
    const buf = readBytesRaw(file, pos, want);
    if (!buf.length) break;
    pos += buf.length;
    const region: Buffer = carry.length ? Buffer.concat([carry, buf]) : buf;
    const nl = region.lastIndexOf(0x0a);
    if (nl < 0) { carry = region; if (buf.length < want) break; continue; } // no complete line yet
    carry = region.subarray(nl + 1); // partial trailing line waits for its newline
    for (const ln of region.subarray(0, nl + 1).toString('utf8').split('\n')) {
      // Cheap pre-filter: a contributing line must serialize message.usage, and
      // most transcript bytes are tool results that never do.
      if (!ln || ln.indexOf('"usage"') < 0) continue;
      const o = parse(ln);
      const m = o && o.message;
      if (!m || m.role !== 'assistant' || !m.usage) continue;
      const u = m.usage;
      if (m.model) cur.model = m.model; // a line without a model inherits the one in effect
      const b = bucketFor(cur, cur.model);
      const inT = u.input_tokens || 0, out = u.output_tokens || 0;
      const cr = u.cache_read_input_tokens || 0, cc = u.cache_creation_input_tokens || 0;
      b.inT += inT; b.out += out; b.cr += cr; b.cc += cc;
      // the last assistant turn's input is the live context-window occupancy
      cur.lastCtx = inT + cr + cc;
    }
    cur.offset = pos - carry.length;
    if (buf.length < want) break; // file shrank mid-scan; the next call's stat resets it
  }
}

export function readClaudeUsage(file: string, opts: { chunkBytes?: number } = {}): UsageInfo {
  let st: fs.Stats | null;
  try { st = fs.statSync(file); } catch { st = null; }
  let cur = st ? usageCursors.get(file) : undefined;
  if (st) {
    if (!cur || cur.ino !== st.ino || st.size < cur.lastSize || st.size < cur.offset) {
      cur = { ino: st.ino, offset: 0, lastSize: 0, model: '', lastCtx: 0, byModel: new Map() }; // first sight, rotation, or truncation
    }
    if (st.size > cur.offset) {
      try { usageScanForward(file, cur, st.size, opts.chunkBytes); } catch { /* partial totals beat none */ }
    }
    cur.lastSize = st.size;
    usageCursors.delete(file); usageCursors.set(file, cur); // reinsert at the tail: LRU
    if (usageCursors.size > USAGE_CURSOR_CAP) {
      const oldest = usageCursors.keys().next().value;
      if (oldest !== undefined) usageCursors.delete(oldest);
    }
  }
  let inT = 0, out = 0, cr = 0, cc = 0, costUSD = 0;
  if (cur) {
    for (const [model, b] of cur.byModel) {
      const p = priceFor(model); // each model priced at its own rate, never the session's last
      costUSD += (b.inT * p.in + b.out * p.out + b.cr * p.cacheRead + b.cc * p.cacheWrite) / 1e6;
      inT += b.inT; out += b.out; cr += b.cr; cc += b.cc;
    }
  }
  const model = cur ? cur.model : '';
  const lastCtx = cur ? cur.lastCtx : 0;
  const ctxWin = contextWindowFor(model);
  return { harness: 'claude-code', model, metered: true, costUSD, apiEquivUSD: null, rateLimits: null,
    contextWindow: ctxWin, contextTokens: lastCtx, contextPct: ctxWin ? Math.min(100, Math.round((lastCtx / ctxWin) * 100)) : null,
    tokens: { input: inT, output: out, cacheRead: cr, cacheCreate: cc, total: inT + out + cr + cc } };
}

function readCodexUsage(file: string): UsageInfo {
  const tail = readSlice(file, 1024 * 1024, true).split('\n');
  let last: Record<string, any> | null = null;
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

// Public: per-session usage. Cheap on repeat calls (mtime+size cache), and cheap
// on a MISS too for Claude: every append busts this key, but readClaudeUsage's
// per-file cursor then reads only the appended bytes rather than re-reading the
// whole transcript on every 20s poll.
export function readUsage(file: string, harness: Harness | string): UsageInfo | null {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}:${st.mtimeMs}:${st.size}`;
  const cached = usageCache.get(key);
  if (cached) return cached;
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
export const TIER_HOT_MS = 24 * 60 * 60 * 1000;
export const TIER_DRIFT_MS = 7 * 24 * 60 * 60 * 1000;
// "working" freshness window: how recently a session must have moved for a
// user-last turn or a progress-shaped tail to count as actively worked.
export const FRESH_MS = 30 * 60 * 1000;
// Back-compat alias: lib/pulse.ts gates open notes and waiting sessions on
// this. It now equals the hot tier (the mining moved it from 18h to 24h).
export const NEED_DECAY_MS = TIER_HOT_MS;

export interface AccountStatus {
  per: {
    codex: { sessions: number; generated: number; totalTokens: number; apiEquivUSD: number };
    'claude-code': { sessions: number; generated: number; totalTokens: number; costUSD: number };
  };
  codexQuota: unknown;
  needsYou: number;
  working: number;
  nearCompaction: number;
  sessions: number;
  pricingAsOf: string;
  generatedAt: number;
}

// Public: account-level rollup for the top bar. Real spend estimate for Claude
// (metered), real rate-limit quota for Codex (plan-billed), and a needs-you count.
export function accountStatus(opts: ListRecentOpts = {}): AccountStatus {
  const rows = listRecent(opts);
  const per = {
    codex: { sessions: 0, generated: 0, totalTokens: 0, apiEquivUSD: 0 },
    'claude-code': { sessions: 0, generated: 0, totalTokens: 0, costUSD: 0 },
  };
  let codexQuota: unknown = null, codexQuotaAge = Infinity, nearCompaction = 0;
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
      (b as { costUSD: number }).costUSD += u.costUSD || 0;
    } else {
      b.generated += ((u.tokens && u.tokens.output) || 0) + ((u.tokens && u.tokens.reasoning) || 0);
      (b as { apiEquivUSD: number }).apiEquivUSD += u.apiEquivUSD || 0;
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

interface RowExtras {
  lastUser: string;
  prevAgent: string;
  model: string;
  reasoningEffort: string | null;
  ultracode: boolean;
  customTitle: string;
}

interface SessionDetail {
  harness: Harness | string;
  lastExchange: { lastUser: string; prevAgent: string };
  linearRefs: { url: string; label: string }[];
  htmlFiles: string[];
  skillsUsed: Record<string, number>;
  skillCount: number;
  reasoningEffort: string | null;
  model: string;
  ultracode: boolean;
}

const rowCache = new Map<string, RowExtras>();
const detailCache = new Map<string, SessionDetail>();
const LINEAR_RE = /https?:\/\/linear\.app\/[a-z0-9-]+\/(?:issue|project)\/[^\s)"'<>\]]+/gi;

const clip = (s: string | null | undefined, n: number) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
function assistantText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((x) => x && x.type === 'text').map((x) => x.text || '').join(' ');
  return '';
}
function genuineUserText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    if (content.some((x) => x && x.type === 'tool_result')) return '';
    return content.filter((x) => x && x.type === 'text').map((x) => x.text || '').join(' ');
  }
  return '';
}
function linearLabel(u: string): string {
  const im = u.match(/\/issue\/([A-Za-z0-9]+-\d+)/);
  if (im) return im[1].toUpperCase();
  const pm = u.match(/\/project\/([a-z0-9-]+)/i);
  if (pm) return pm[1].replace(/-[0-9a-f]{8,}$/i, '').replace(/-/g, ' ').split(' ').filter(Boolean).slice(0, 4).join(' ') || 'project';
  return 'linear';
}
function collectLinear(text: string | null | undefined, map: Map<string, { url: string; label: string }>): void {
  if (!text) return;
  const m = String(text).match(LINEAR_RE);
  if (!m) return;
  for (let u of m) { u = u.replace(/[).,\]]+$/, ''); if (!map.has(u)) map.set(u, { url: u, label: linearLabel(u) }); }
}
function collectHtmlFromCmd(cmd: string | null | undefined, set: Set<string>): void {
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
export const ISSUE_KEY_RE = /\b([A-Za-z]{2,})-(\d+)\b/g;

export function extractIssueKeys(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
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
const issueRefCache = new Map<string, { keys: string[]; urls: { url: string; label: string }[] }>();
export function readIssueRefs(file: string): { keys: string[]; urls: { url: string; label: string }[] } {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return { keys: [], urls: [] }; }
  const ckey = `${file}:${st.mtimeMs}:${st.size}`;
  const cached = issueRefCache.get(ckey);
  if (cached) return cached;
  const text = readSlice(file, HEAD_BYTES, false) + '\n' + readSlice(file, TAIL_BYTES, true);
  const linear = new Map<string, { url: string; label: string }>();
  collectLinear(text, linear);
  const keys = new Set<string>();
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
const workRefCache = new Map<string, { roots: string[]; tokens: string[] }>();
const tokenRegexCache = new Map<string, RegExp | null>();

function vocabSig(list: string[]): string {
  let h = 5381;
  const s = list.join('\n');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${list.length}:${h}`;
}

function tokenRegexFor(tokens: string[], sig: string): RegExp | null {
  if (tokenRegexCache.has(sig)) return tokenRegexCache.get(sig) ?? null;
  let re: RegExp | null = null;
  if (tokens.length) {
    const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    re = new RegExp(`(?:${escaped.join('|')})`, 'g');
  }
  tokenRegexCache.set(sig, re);
  if (tokenRegexCache.size > 20) tokenRegexCache.clear();
  return re;
}

export function readWorkRefs(file: string, opts: { roots?: string[]; tokens?: string[] } = {}): { roots: string[]; tokens: string[] } {
  const roots = opts.roots || [];
  const tokens = opts.tokens || [];
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return { roots: [], tokens: [] }; }
  const sig = `${vocabSig(roots)}|${vocabSig(tokens)}`;
  const ckey = `${file}:${st.mtimeMs}:${st.size}:${sig}`;
  const cached = workRefCache.get(ckey);
  if (cached) return cached;
  const text = readSlice(file, TAIL_BYTES, true);
  const rootSet = new Set(roots);
  const matchedRoots = new Set<string>();
  const seen = new Set<string>();
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
  const matchedTokens = new Set<string>();
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
function readRowExtras(file: string, harness: Harness | string): RowExtras | null {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}:${st.mtimeMs}:${st.size}`;
  const cached = rowCache.get(key);
  if (cached) return cached;
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
  const res: RowExtras = { lastUser: clip(lastUser, 200), prevAgent: clip(prevAgent, 200), model, reasoningEffort: effort || null, ultracode: ultra, customTitle: customTitle || '' };
  rowCache.set(key, res);
  if (rowCache.size > 800) rowCache.clear();
  return res;
}

// Full per-session extraction for the detail view (cached by mtime).
export function readDetail(file: string, harness: Harness | string): SessionDetail | null {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}:${st.mtimeMs}:${st.size}`;
  const cached = detailCache.get(key);
  if (cached) return cached;
  const claude = harness === 'claude-code' || file.includes('/.claude/');
  // Tail-anchored past the cap: lastExchange must be the REAL last exchange.
  // Head-anchored, a live 12MB+ session showed an hour-stale 8-char user line
  // as "you asked" while the actual reply from minutes ago was invisible.
  const fromEnd = st.size > MAX_READ;
  const lines = readSlice(file, MAX_READ, fromEnd).split('\n');
  if (fromEnd && lines.length) lines.shift();
  let lastUser = '', prevAgent = '', rollingAgent = '', model = '', effort = '', ultra = false, skillCount = 0;
  const skills: Record<string, number> = {}, linear = new Map<string, { url: string; label: string }>(), html = new Set<string>();
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
  const res: SessionDetail = {
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

export interface SkillAggregate {
  skills: Record<string, number>;
  sessionsWithSkills: number;
  totalInvocations: number;
}

// Aggregate skill usage across recent sessions (Claude only; Codex has no
// structured skill calls). Heavier (full reads), cached; call off the hot path.
export function aggregateSkills(opts: ListRecentOpts = {}): SkillAggregate {
  const rows = listRecent(opts);
  const skills: Record<string, number> = {};
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
// A function, not a const: see home() above.
export function notesFile(): string { return path.join(home(), '.humanctl', 'notes.jsonl'); }
const NOTE_LEVELS = new Set(['fyi', 'review', 'blocked', 'done']);

export interface NoteRecord {
  id: string;
  ts: string;
  level: 'fyi' | 'review' | 'blocked' | 'done';
  message: string;
  cwd?: string;
  repo?: string;
  session?: string;
  agent?: string;
  attachments?: string[];
  [key: string]: unknown;
}

export function readNotes(opts: { limit?: number } = {}): NoteRecord[] {
  let txt: string;
  try { txt = readSlice(notesFile(), 512 * 1024, true); } catch { return []; } // bounded tail; file is append-only
  if (!txt) return [];
  const notes = txt.split('\n').filter(Boolean).map((l) => {
    try {
      const o = JSON.parse(l);
      return (o && typeof o === 'object' && typeof o.message === 'string' && o.id) ? { ...o, level: NOTE_LEVELS.has(o.level) ? o.level : 'fyi' } : null;
    } catch { return null; }
  }).filter((n): n is NoteRecord => n !== null);
  notes.reverse(); // newest first
  return notes.slice(0, opts.limit || 100);
}

export { harnesses };

// CLI smoke: `node dist/lib/sessions.js` prints a quick table (read-only).
if (require.main === module) {
  const rows = listRecent({ maxAgeH: 72, limit: 15 });
  console.log(`recent sessions: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `${r.age.padStart(4)}  ${r.harness.padEnd(11)}  ${r.state.padEnd(4)}  ${r.tier.padEnd(8)}  ${(r.repo || '?').slice(0, 28).padEnd(28)}  ${(r.id).slice(0, 10)}  ${(r.stateReason || '').slice(0, 34).padEnd(34)}  ${r.title.slice(0, 40)}`
    );
  }
}
