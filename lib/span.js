'use strict';

// Span of control: how many agent sessions one human actually touched in a
// day, plus the human-side signals (notes, merged PRs) for the same day. All
// counts are for one local calendar day. Missing sources report null instead
// of a fabricated zero; see docs/span.md.
//
// Extracted from bin/humanctl.js so `humanctl span` and the span.run command
// (lib/commands.js) share one implementation.

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function globalDir() {
  return path.join(os.homedir(), '.humanctl');
}

function nowIso() {
  return new Date().toISOString();
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

const NOTE_LEVELS = new Set(['fyi', 'review', 'blocked', 'done']);

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

function mtimeInWindow(filePath, dayStartMs, dayEndMs) {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtimeMs >= dayStartMs && stat.mtimeMs < dayEndMs;
  } catch {
    return false;
  }
}

// Bounded first-line read. Codex writes session_meta as the first JSON line of
// every rollout file, but that line embeds the base instructions and runs tens
// of kilobytes (max observed locally: ~42KB), so the bound is 96KB, not a few
// KB. Never reads the rest of the file. Returns null on any read failure.
const CODEX_META_HEAD_BYTES = 96 * 1024;
function readFirstLine(filePath, maxBytes) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return null;
  }

  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    const chunk = buffer.toString('utf8', 0, bytesRead);
    const newline = chunk.indexOf('\n');
    return newline === -1 ? chunk : chunk.slice(0, newline);
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// Classify one Codex rollout file as "interactive", "automation", or
// "unknown" from its session_meta first line. Same semantics as
// isCodexAutomation in lib/sessions.js: subagent threads, codex exec runs,
// and scheduled automation runs are automation; sessions a human drove (Codex
// Desktop, VS Code, the interactive CLI) are interactive. The desktop app
// additionally detects scheduled runs by prompt shape; here the thread_source
// field ("user" / "subagent" / "automation", stamped by newer Codex versions)
// covers that case without reading past the first line. Anything unparseable
// or missing recognizable meta is "unknown", never guessed.
function classifyCodexRollout(filePath) {
  const line = readFirstLine(filePath, CODEX_META_HEAD_BYTES);
  if (!line) {
    return 'unknown';
  }

  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return 'unknown';
  }

  const meta = record && typeof record === 'object' ? record.payload || record : null;
  if (!meta || typeof meta !== 'object') {
    return 'unknown';
  }
  if (!meta.originator && !meta.source && !meta.thread_source && !meta.parent_thread_id && !meta.cli_version) {
    return 'unknown';
  }

  if (meta.parent_thread_id) return 'automation';
  if (meta.agent_role || meta.agent_nickname) return 'automation';
  if (meta.source && typeof meta.source === 'object' && meta.source.subagent) return 'automation';
  if (meta.originator === 'codex_exec' || meta.source === 'exec') return 'automation';
  if (meta.thread_source === 'subagent' || meta.thread_source === 'automation') return 'automation';
  return 'interactive';
}

// Codex writes one rollout-*.jsonl per session under
// ~/.codex/sessions/YYYY/MM/DD/. Sessions resumed later keep their original
// date directory, so scan date dirs within 7 days of the target instead of the
// whole tree. Every rollout file touched that day counts toward the total;
// each is also classified interactive vs automation from its session_meta
// first line (see classifyCodexRollout). Null if ~/.codex/sessions is missing.
function countCodexSessionsTouched(dayStart, dayEnd) {
  const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');

  if (!fs.existsSync(sessionsRoot)) {
    return null;
  }

  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const counts = { total: 0, interactive: 0, automation: 0, unknown: 0 };

  for (let offset = -7; offset <= 7; offset += 1) {
    const scanDay = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + offset);
    const dayDir = path.join(
      sessionsRoot,
      String(scanDay.getFullYear()),
      String(scanDay.getMonth() + 1).padStart(2, '0'),
      String(scanDay.getDate()).padStart(2, '0')
    );

    let entries;
    try {
      entries = fs.readdirSync(dayDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !/^rollout-.*\.jsonl$/.test(entry.name)) {
        continue;
      }
      const filePath = path.join(dayDir, entry.name);
      if (!mtimeInWindow(filePath, dayStartMs, dayEndMs)) {
        continue;
      }
      counts.total += 1;
      counts[classifyCodexRollout(filePath)] += 1;
    }
  }

  return counts;
}

// The one Claude-side automation humanctl itself generates: the desktop app
// summarizes sessions via headless `claude -p` one-shots, and each of those
// leaves a session file. Same prompt-shape check as lib/sessions.js. The
// prompt sits at the top of the transcript (as a queue-operation line or the
// first user message), so an 8KB head read is enough; anything else counts as
// interactive. Other people's `claude -p` automations are not detectable this
// cheaply and are not guessed at.
const CLAUDE_HEAD_BYTES = 8 * 1024;
const HUMANCTL_SUMMARY_PROMPT_RE = /^Summarize the recent tail of an autonomous coding-agent session/i;
function isHumanctlSummaryOneShot(filePath) {
  let fd;
  let head = '';
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(CLAUDE_HEAD_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, CLAUDE_HEAD_BYTES, 0);
    head = buffer.toString('utf8', 0, bytesRead);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  for (const line of head.split('\n')) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record || typeof record !== 'object') {
      continue;
    }

    const texts = [];
    if (record.type === 'queue-operation' && typeof record.content === 'string') {
      texts.push(record.content);
    }
    const message = record.message;
    if (message && message.role === 'user') {
      if (typeof message.content === 'string') {
        texts.push(message.content);
      } else if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (item && item.type === 'text' && typeof item.text === 'string') {
            texts.push(item.text);
          }
        }
      }
    }

    for (const text of texts) {
      if (HUMANCTL_SUMMARY_PROMPT_RE.test(text.trim())) {
        return true;
      }
    }
  }

  return false;
}

// Claude Code writes one *.jsonl per session directly inside each
// ~/.claude/projects/<project>/ dir. Subdirectories (subagents etc.) are
// intentionally not counted. Every file touched that day counts toward the
// total; humanctl's own summarize one-shots are split out so interactive
// reflects sessions a human actually drove. Null if ~/.claude/projects is
// missing.
function countClaudeSessionsTouched(dayStart, dayEnd) {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');

  if (!fs.existsSync(projectsRoot)) {
    return null;
  }

  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const counts = { total: 0, interactive: 0 };
  let projects;

  try {
    projects = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const project of projects) {
    if (!project.isDirectory()) {
      continue;
    }

    const projectDir = path.join(projectsRoot, project.name);
    let entries;
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }
      const filePath = path.join(projectDir, entry.name);
      if (!mtimeInWindow(filePath, dayStartMs, dayEndMs)) {
        continue;
      }
      counts.total += 1;
      if (!isHumanctlSummaryOneShot(filePath)) {
        counts.interactive += 1;
      }
    }
  }

  return counts;
}

function countNotesForDay(dayStart, dayEnd) {
  const notesPath = path.join(globalDir(), 'notes.jsonl');

  if (!fs.existsSync(notesPath)) {
    return null;
  }

  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const counts = { fyi: 0, review: 0, blocked: 0, done: 0 };

  for (const line of safeReadFile(notesPath).split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let note;
    try {
      note = JSON.parse(line);
    } catch {
      continue;
    }

    const tsMs = Date.parse(note?.ts);
    if (!Number.isFinite(tsMs) || tsMs < dayStartMs || tsMs >= dayEndMs) {
      continue;
    }

    if (NOTE_LEVELS.has(note.level)) {
      counts[note.level] += 1;
    }
  }

  return counts;
}

// Real signal or null, never a guess: any gh failure (missing binary, offline,
// auth, rate limit) reports null rather than zero.
function countPrsMergedByMe(dateString) {
  try {
    const stdout = childProcess.execFileSync(
      'gh',
      [
        'search',
        'prs',
        '--author=@me',
        '--merged',
        `--merged-at=${dateString}`,
        '--json',
        'number',
        '--limit',
        '100',
      ],
      { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

// One full span record for the local day starting at dayStart.
function computeSpanRecord(dayStart) {
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  const date = localDateString(dayStart);

  const codex = countCodexSessionsTouched(dayStart, dayEnd);
  const claude = countClaudeSessionsTouched(dayStart, dayEnd);

  return {
    date,
    codexSessionsTouched: codex === null ? null : codex.total,
    codexInteractiveTouched: codex === null ? null : codex.interactive,
    codexAutomationTouched: codex === null ? null : codex.automation,
    codexUnknown: codex === null ? null : codex.unknown,
    claudeSessionsTouched: claude === null ? null : claude.total,
    claudeInteractiveTouched: claude === null ? null : claude.interactive,
    notes: countNotesForDay(dayStart, dayEnd),
    prsMergedByMe: countPrsMergedByMe(date),
    generatedAt: nowIso(),
  };
}

// Upsert by date: one line per local day in ~/.humanctl/span.jsonl, so
// re-recording refreshes that day instead of appending duplicates.
function upsertSpanRecord(record) {
  const dir = globalDir();
  fs.mkdirSync(dir, { recursive: true });
  const spanPath = path.join(dir, 'span.jsonl');
  const kept = [];
  let replaced = false;

  for (const line of safeReadFile(spanPath).split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let existing;
    try {
      existing = JSON.parse(line);
    } catch {
      kept.push(line);
      continue;
    }

    if (existing?.date === record.date) {
      if (!replaced) {
        kept.push(JSON.stringify(record));
        replaced = true;
      }
      continue;
    }

    kept.push(line);
  }

  if (!replaced) {
    kept.push(JSON.stringify(record));
  }

  const tempPath = `${spanPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${kept.join('\n')}\n`, 'utf8');
  fs.renameSync(tempPath, spanPath);
  return spanPath;
}

module.exports = {
  localDateString,
  parseLocalDate,
  computeSpanRecord,
  upsertSpanRecord,
};
