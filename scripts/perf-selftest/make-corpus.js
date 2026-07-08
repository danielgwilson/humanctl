'use strict';
// Realistic-scale synthetic transcript corpus for the perf gate.
//
// The perf harness runs the app against an isolated scratch HOME (see run.js);
// by default that HOME is empty, so the session reader (lib/sessions.ts) has
// nothing to read and the gate is BLIND to the real failure: on a busy fleet
// the reader synchronously reads + JSON.parses dozens of large transcripts on
// the Electron MAIN process and blocks the event loop (window-drag jank). This
// writes a fleet of Claude Code + Codex transcripts into the scratch HOME so
// `listRecent({ withUsage: true })` does real work, exposing that blocking to
// the event-loop-delay measurement in main.ts.
//
// Content is synthetic and deterministic (no Math.random / Date.now-derived
// entropy in the bytes) so runs are reproducible; only file mtimes are set
// recent so the reader's 72h window picks them up.
const fs = require('node:fs');
const path = require('node:path');

function line(obj) { return JSON.stringify(obj) + '\n'; }

// One Claude Code transcript: alternating user/assistant/tool JSONL lines, the
// shapes lib/sessions.ts actually parses (message.role, content text blocks,
// tool_use / tool_result). `lines` controls how heavy the parse is.
function claudeTranscript(id, lines, nowMs) {
  const parts = [];
  for (let i = 0; i < lines; i++) {
    const ts = new Date(nowMs - (lines - i) * 1000).toISOString();
    const m = i % 4;
    if (m === 0) {
      parts.push(line({ type: 'user', message: { role: 'user', content: `synthetic instruction ${i} for the perf corpus session ${id}, padded to give the parser real work to do across many lines` }, timestamp: ts }));
    } else if (m === 1) {
      parts.push(line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `synthetic assistant turn ${i}: analyzing, editing, and re-running. This block is intentionally verbose so JSON.parse and the downstream text scan cost real cycles per line.` }] }, timestamp: ts }));
    } else if (m === 2) {
      parts.push(line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: `/synthetic/repo/file-${i}.ts`, old_string: 'a'.repeat(120), new_string: 'b'.repeat(120) } }] }, timestamp: ts }));
    } else {
      parts.push(line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok '.repeat(80) }] }, timestamp: ts }));
    }
  }
  return parts.join('');
}

// One Codex rollout transcript (session_meta + response_item lines).
function codexTranscript(id, lines, nowMs) {
  const parts = [line({ type: 'session_meta', payload: { id, cwd: `/synthetic/repo-${id}` }, timestamp: new Date(nowMs - lines * 1000).toISOString() })];
  for (let i = 0; i < lines; i++) {
    const ts = new Date(nowMs - (lines - i) * 1000).toISOString();
    const m = i % 3;
    if (m === 0) parts.push(line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `synthetic codex instruction ${i} for session ${id}` }] }, timestamp: ts }));
    else if (m === 1) parts.push(line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `synthetic codex output ${i}, verbose enough to cost parse cycles across the whole rollout file` }] }, timestamp: ts }));
    else parts.push(line({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'echo ' + 'x'.repeat(100)] }) }, timestamp: ts }));
  }
  return parts.join('');
}

// Populate <home> with a realistic fleet. `scale` tunes it: claude/codex file
// counts and line depth. Returns a small summary for logging.
function makeCorpus(home, { claudeFiles = 300, codexFiles = 110, lines = 1400, recentMs } = {}) {
  // Defaults model a real power-user fleet: the status path reads up to 200
  // transcripts per poll (lib/sessions.ts listRecent limit:200), so a fleet
  // well over 200 recent files with heavy transcripts is what actually blocks
  // main. `hotFiles` are the handful the perf gate appends to during the run
  // to fire the fs watcher and force re-scans (active-agent write pressure).
  const nowMs = recentMs || (Date.now());
  const claudeRoot = path.join(home, '.claude', 'projects');
  const codexRoot = path.join(home, '.codex', 'sessions');
  fs.mkdirSync(claudeRoot, { recursive: true });
  fs.mkdirSync(codexRoot, { recursive: true });
  const hotFiles = [];
  let bytes = 0;
  for (let i = 0; i < claudeFiles; i++) {
    const proj = path.join(claudeRoot, `-synthetic-repo-${i % 12}`);
    fs.mkdirSync(proj, { recursive: true });
    const id = `claude-${String(i).padStart(4, '0')}-c3c3c3c3c3c3`;
    const body = claudeTranscript(id, lines, nowMs);
    const f = path.join(proj, `${id}.jsonl`);
    fs.writeFileSync(f, body);
    // mtime recent (spread over the last few hours) so the 72h window keeps it.
    const t = new Date(nowMs - (i % 24) * 3600 * 1000);
    fs.utimesSync(f, t, t);
    if (i < 6) hotFiles.push(f); // the most-recent handful, for write pressure
    bytes += body.length;
  }
  for (let i = 0; i < codexFiles; i++) {
    const id = `codex-${String(i).padStart(4, '0')}-d4d4d4d4d4d4`;
    const body = codexTranscript(id, lines, nowMs);
    const f = path.join(codexRoot, `${id}.jsonl`);
    fs.writeFileSync(f, body);
    const t = new Date(nowMs - (i % 24) * 3600 * 1000);
    fs.utimesSync(f, t, t);
    bytes += body.length;
  }
  return { claudeFiles, codexFiles, lines, totalFiles: claudeFiles + codexFiles, mb: +(bytes / 1048576).toFixed(1), hotFiles };
}

module.exports = { makeCorpus };

// CLI: `node make-corpus.js <homeDir>` for manual inspection.
if (require.main === module) {
  const home = process.argv[2];
  if (!home) { console.error('usage: node make-corpus.js <homeDir>'); process.exit(1); }
  console.log(JSON.stringify(makeCorpus(home)));
}
