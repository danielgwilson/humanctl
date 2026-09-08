#!/usr/bin/env node

import { randomUUID } from 'crypto';
import childProcess from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { URL } from 'url';

import {
  type FlagValue,
  type Flags,
  type OptionSpec,
  appendWorkspaceEvent,
  artifactDirectory,
  artifactEntryName,
  artifactManifestPath,
  askDirectory,
  askManifestPath,
  booleanFlag,
  ensureDir,
  ensureObjectExists,
  ensureWorkspaceExists,
  flagValue,
  hasFlag,
  listDirectoryIds,
  multiFlagValues,
  nowIso,
  outputResult,
  parseFlags,
  parseIdList,
  parseOptionSpec,
  readJson,
  renderTypeForPath,
  safeReadFile,
  slugify,
  titleFromId,
  updateUiState,
  watchDirectory,
  watchManifestPath,
  workspaceDirFor,
  writeJson,
} from './cli-util';
import {
  closeAsk,
  hubSend,
  hubUsage,
  originForWorkspace,
  pushArtifact,
  pushAsk,
  pushNote,
  recordAnswer,
  reportHubOutcome,
  runHubCommand,
  waitForAnswer,
} from './hub-commands';

// Global cross-repo inbox: agents post short aside/BTW messages to the human
// here; the desktop app surfaces them. One file across all repos on purpose.
// The write itself is the registered note.post command (lib/commands.ts), so
// `humanctl note` is sugar over the same registry the app uses, and every
// note lands in the event log too.
function globalDir(): string {
  return path.join(os.homedir(), '.humanctl');
}


const NOTE_LEVELS = new Set(['fyi', 'review', 'blocked', 'done']);
async function appendNote(message: string, flags: Flags): Promise<void> {
  const { createRegistry } = require('../lib/commands') as typeof import('../lib/commands');
  // Preserve the historical lenience: an unknown --level degrades to fyi
  // instead of tripping the registry's enum validation.
  let level = String(flagValue(flags, 'level', 'fyi') || 'fyi').toLowerCase();
  if (!NOTE_LEVELS.has(level)) level = 'fyi';
  // --image is repeatable (max 4, enforced by note.post/postNote); paths are
  // resolved relative to cwd here so a relative --image path behaves the way
  // a shell user expects, matching how --repo/--cwd already work.
  const images = multiFlagValues(flags, 'image').map((p) => path.resolve(process.cwd(), String(p)));
  const result = await createRegistry().invoke('note.post', {
    message,
    level,
    repo: flagValue(flags, 'repo', '') || undefined,
    session: flagValue(flags, 'session', '') || flagValue(flags, 'id', '') || undefined,
    agent: flagValue(flags, 'agent', '') || process.env.HUMANCTL_AGENT || undefined,
    cwd: process.cwd(),
    images: images.length ? images : undefined,
  }, { source: 'cli-direct' });
  if (!result.ok) {
    console.error(`humanctl note failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  const skippedImages = result.skippedImages as { path: string; reason: string }[] | undefined;
  if (skippedImages && skippedImages.length) {
    for (const s of skippedImages) console.error(`humanctl note: skipped image ${s.path} (${s.reason})`);
  }
  const note = result.note as { id: string; ts: string; level: string; message: string; cwd: string; repo: string; session: string; agent: string; attachments?: string[] };
  // With a hub configured the note (and its images, as artifacts) also land
  // there; the local notes.jsonl write above is the durable record either way.
  const hubOutcome = await pushNote(note, flags);
  if (hasFlag(flags, 'json')) console.log(JSON.stringify({ ...note, hub: hubOutcome }));
  else {
    const attTxt = note.attachments && note.attachments.length ? ` [${note.attachments.length} image${note.attachments.length === 1 ? '' : 's'}]` : '';
    console.log(`noted (${note.level}): ${note.message}${attTxt}`);
  }
  reportHubOutcome(hubOutcome, flags);
}

// Span of control: the computation lives in lib/span.ts (shared with the
// span.run registered command in lib/commands.ts); this file only owns the
// flags and the human-readable rendering. See docs/span.md.

function formatSpanCount(value: number | null): string {
  return value === null ? 'unavailable' : String(value);
}

async function spanCommand(flags: Flags): Promise<void> {
  const { createRegistry } = require('../lib/commands') as typeof import('../lib/commands');
  const dateFlag = flagValue(flags, 'date');
  const params: { record: boolean; date?: string } = { record: booleanFlag(flags, 'record', false) };
  if (dateFlag !== undefined) {
    if (dateFlag === true) {
      console.error('humanctl span requires --date in YYYY-MM-DD form.');
      process.exit(1);
    }
    params.date = String(dateFlag);
  }

  const result = await createRegistry().invoke('span.run', params, { source: 'cli-direct' });
  if (!result.ok) {
    console.error(`humanctl span failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  const record = result.span as Record<string, unknown>;
  const recordedTo = result.recordedTo as string | undefined;

  outputResult(recordedTo ? { ...record, recordedTo } : record, flags, (value: any) => {
    console.log(`Span for ${value.date} (local day)`);
    console.log(`  codex interactive        ${formatSpanCount(value.codexInteractiveTouched)}`);
    console.log(`  codex automation         ${formatSpanCount(value.codexAutomationTouched)} (subagents, codex exec, scheduled runs)`);
    if (value.codexUnknown !== null && value.codexUnknown > 0) {
      console.log(`  codex unknown            ${value.codexUnknown}`);
    }
    console.log(`  codex total touched      ${formatSpanCount(value.codexSessionsTouched)}`);
    console.log(`  claude interactive       ${formatSpanCount(value.claudeInteractiveTouched)}`);
    console.log(`  claude total touched     ${formatSpanCount(value.claudeSessionsTouched)}`);
    if (value.notes === null) {
      console.log('  notes                    unavailable');
    } else {
      const { fyi, review, blocked, done } = value.notes;
      console.log(`  notes                    fyi ${fyi} / review ${review} / blocked ${blocked} / done ${done}`);
    }
    console.log(`  PRs merged by me         ${formatSpanCount(value.prsMergedByMe)}`);
    if (value.recordedTo) {
      console.log(`Recorded to ${value.recordedTo}`);
    }
  });
}

function usage(): void {
  console.log(`humanctl

Usage:
  humanctl init [dir]
  humanctl status [dir] [--json]

  humanctl note [--level fyi|review|blocked|done] [--session id] [--repo name] [--image path ...] "message"
    post a short aside/BTW to the human (shows in the humanctl desktop inbox).
    --image is repeatable (max 4, png/jpg/gif/webp, <=10MB each) for proof
    screenshots; each is copied into ~/.humanctl/attachments/ and rendered
    inline in the Inbox and thread detail.

  humanctl span [--date YYYY-MM-DD] [--record] [--json]
    daily span-of-control counts: interactive vs automation sessions touched,
    notes, PRs merged (see docs/span.md)

  humanctl pulse [--json] [--repo name] [--lane lane] [--fresh]
    read-only reconciliation of Linear issues, local git worktrees, GitHub
    PRs/checks, agent sessions, and notes into exclusive attention lanes:
    needs-you, ready-for-review, blocked-on-agent, stale, missing-owner,
    verified. Config at ~/.humanctl/pulse.json (see docs/pulse.md)

  humanctl ask create [--workspace dir] --title text --prompt text [--summary text] [--artifact id]
    [--attach file ...] [--watch id] [--option "choice-id|Label|Description"] [--recommended choice-id]
    [--reason text] [--unblocks text] [--escalation ask] [--why-now text] [--if-ignored text]
    [--status open] [--session id] [--agent name] [--no-hub] [--require-hub] [--json]
    a decision for the human. With a hub configured (humanctl hub config) the ask and
    its artifacts are pushed after the local write. --recommended plus --reason is what
    puts an ask in the hub's one-tap Decide group; without them it waits for words.
  humanctl ask list [--workspace dir] [--json]
  humanctl ask get <id> [--workspace dir] [--wait] [--timeout 540] [--no-hub] [--json]
    --wait polls the local manifest, then the hub, until an answer exists (exit 0),
    the ask is closed (exit 4), or --timeout seconds pass (exit 3; run it again to keep waiting)
  humanctl ask close <id> [--workspace dir] [--status withdrawn|expired] [--proceeded-with choice-id] [--note text] [--json]
    the agent withdrew the ask or proceeded without an answer; the hub moves it to Recent
  humanctl ask update <id> [--workspace dir] [--title text] [--prompt text] [--summary text]
    [--artifact id] [--watch id] [--option "choice-id|Label|Description"] [--recommended choice-id]
    [--escalation ask] [--status open] [--why-now text] [--if-ignored text] [--clear-answer] [--json]
  humanctl ask answer <id> [--workspace dir] [--choice choice-id] [--note text] [--json]
  humanctl ask delete <id> [--workspace dir] [--json]

  humanctl artifact put <file> [--workspace dir] [--title text] [--summary text] [--kind preview]
    [--status active] [--label tag] [--pin true] [--id artifact-id] [--json]
  humanctl artifact list [--workspace dir] [--json]
  humanctl artifact get <id> [--workspace dir] [--json]
  humanctl artifact delete <id> [--workspace dir] [--json]

  humanctl watch create [--workspace dir] --title text --condition-summary text [--summary text]
    [--kind presence] [--status active] [--escalation nudge] [--last-checked-at iso] [--next-check-at iso] [--json]
  humanctl watch list [--workspace dir] [--json]
  humanctl watch get <id> [--workspace dir] [--json]
  humanctl watch update <id> [--workspace dir] [--title text] [--condition-summary text] [--summary text]
    [--kind presence] [--status active] [--escalation nudge] [--last-checked-at iso] [--next-check-at iso] [--json]
  humanctl watch delete <id> [--workspace dir] [--json]

  humanctl app [dir] [--port 3000] [--open] [--path /app]
    legacy source-checkout workspace UI; see docs/desktop.md for the real app

  humanctl app list-commands [--json]
    list every command the desktop app registers (see docs/commands.md)
  humanctl app invoke <name> [--json '{"...":"..."}']
    invoke a registered command against the running desktop app
  humanctl app <name> [--param value ...]
    sugar: flags become params, coerced by the command's declared types
    (e.g. humanctl app session.pin --id abc123)
    observations backed by lib/ alone (sessions.list, pulse.run, span.run, ...)
    still answer from disk when the app is not running (source cli-direct);
    actions need the running app.

${hubUsage()}
  humanctl serve [dir] [--port 4173]
`);
}

function askStatusRank(status: string): number {
  switch (status) {
    case 'blocked':
      return 0;
    case 'open':
      return 1;
    case 'draft':
      return 2;
    case 'answered':
      return 3;
    case 'snoozed':
      return 4;
    default:
      return 9;
  }
}

function watchStatusRank(status: string): number {
  switch (status) {
    case 'blocked':
      return 0;
    case 'active':
      return 1;
    case 'quiet':
      return 2;
    case 'paused':
      return 3;
    case 'done':
      return 4;
    default:
      return 9;
  }
}

function artifactRank(artifact: { pinned?: boolean }): number {
  return artifact.pinned ? 0 : 1;
}

function listAsksInWorkspace(workspaceDir: string): any[] {
  return listDirectoryIds(path.join(workspaceDir, 'asks'))
    .map((askId) => readJson(askManifestPath(workspaceDir, askId)))
    .sort((a, b) => {
      const rankDiff = askStatusRank(a.status) - askStatusRank(b.status);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function listArtifactsInWorkspace(workspaceDir: string): any[] {
  return listDirectoryIds(path.join(workspaceDir, 'artifacts'))
    .map((artifactId) => readJson(artifactManifestPath(workspaceDir, artifactId)))
    .sort((a, b) => {
      const rankDiff = artifactRank(a) - artifactRank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function listWatchesInWorkspace(workspaceDir: string): any[] {
  return listDirectoryIds(path.join(workspaceDir, 'watches'))
    .map((watchId) => readJson(watchManifestPath(workspaceDir, watchId)))
    .sort((a, b) => {
      const rankDiff = watchStatusRank(a.status) - watchStatusRank(b.status);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function readArtifactRecord(workspaceDir: string, artifactId: string): any {
  const manifestPath = artifactManifestPath(workspaceDir, artifactId);
  ensureObjectExists(manifestPath, 'Artifact', artifactId);
  const manifest = readJson(manifestPath);
  const contentPath = path.join(artifactDirectory(workspaceDir, artifactId), manifest.render.entry);

  return {
    ...manifest,
    contentPath,
    content: safeReadFile(contentPath),
  };
}

function workspaceSnapshot(baseDir: string): Record<string, unknown> {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifest = readJson(path.join(workspaceDir, 'manifest.json'));
  const asks = listAsksInWorkspace(workspaceDir);
  const artifacts = listArtifactsInWorkspace(workspaceDir);
  const watches = listWatchesInWorkspace(workspaceDir);
  const eventsPath = path.join(workspaceDir, 'inbox', 'events.jsonl');
  const events = safeReadFile(eventsPath).split('\n').filter(Boolean);

  return {
    workspace: manifest,
    path: workspaceDir,
    counts: {
      asks: asks.length,
      artifacts: artifacts.length,
      watches: watches.length,
      events: events.length,
    },
    topAskId: asks[0]?.id,
    topArtifactId: artifacts[0]?.id,
    topWatchId: watches[0]?.id,
  };
}

function initWorkspace(baseDir: string): void {
  const workspaceDir = workspaceDirFor(baseDir);
  const createdAt = nowIso();

  ensureDir(workspaceDir);
  ensureDir(path.join(workspaceDir, 'inbox'));
  ensureDir(path.join(workspaceDir, 'asks'));
  ensureDir(path.join(workspaceDir, 'artifacts'));
  ensureDir(path.join(workspaceDir, 'watches'));
  ensureDir(path.join(workspaceDir, 'policies'));
  ensureDir(path.join(workspaceDir, 'state'));

  const manifestPath = path.join(workspaceDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    writeJson(manifestPath, {
      id: `workspace-${path.basename(path.resolve(baseDir))}`,
      name: path.basename(path.resolve(baseDir)),
      version: 2,
      createdAt,
    });
  }

  const eventsPath = path.join(workspaceDir, 'inbox', 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, '', 'utf8');
  }

  const defaultPolicyPath = path.join(workspaceDir, 'policies', 'default.json');
  if (!fs.existsSync(defaultPolicyPath)) {
    writeJson(defaultPolicyPath, {
      id: 'default',
      allowedChannels: ['inbox', 'desktop', 'focus-app'],
      quietHours: {
        start: '22:00',
        end: '08:00',
      },
      voiceAllowed: false,
      coalesceWindowSeconds: 300,
    });
  }

  const uiStatePath = path.join(workspaceDir, 'state', 'ui.json');
  if (!fs.existsSync(uiStatePath)) {
    writeJson(uiStatePath, {
      route: '/app',
    });
  }

  console.log(`Initialized ${workspaceDir}`);
}

function statusWorkspace(baseDir: string, flags: Flags): void {
  const snapshot = workspaceSnapshot(baseDir);
  outputResult(snapshot, flags, (value: any) => {
    console.log(`Workspace: ${value.workspace.name}`);
    console.log(`Path: ${value.path}`);
    console.log(`Asks: ${value.counts.asks}`);
    console.log(`Artifacts: ${value.counts.artifacts}`);
    console.log(`Watches: ${value.counts.watches}`);
    console.log(`Events: ${value.counts.events}`);
  });
}

function listAsks(baseDir: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const asks = listAsksInWorkspace(workspaceDir);
  outputResult(asks, flags, (items: any[]) => {
    if (items.length === 0) {
      console.log('No asks.');
      return;
    }
    items.forEach((ask) => {
      console.log(`${ask.status.padEnd(8)} ${ask.id}  ${ask.title}`);
    });
  });
}

function getAsk(baseDir: string, askId: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifestPath = askManifestPath(workspaceDir, askId);
  ensureObjectExists(manifestPath, 'Ask', askId);
  const ask = readJson(manifestPath);
  outputResult(ask, flags, (value: any) => {
    console.log(`${value.title} (${value.id})`);
    console.log(value.prompt);
  });
}

function normalizeAskOptions(flags: Flags, existingOptions: OptionSpec[]): (OptionSpec & { recommended: boolean })[] {
  if (!hasFlag(flags, 'option')) {
    return existingOptions as (OptionSpec & { recommended: boolean })[];
  }

  const options = multiFlagValues(flags, 'option').map(parseOptionSpec);
  if (options.length === 0) {
    return existingOptions as (OptionSpec & { recommended: boolean })[];
  }

  const recommendedId = flagValue(flags, 'recommended');
  return options.map((option, index) => ({
    ...option,
    recommended: recommendedId ? option.id === recommendedId : index === 0,
  }));
}

const PLACEHOLDER_OPTIONS = [
  { id: 'looks-good', label: 'Looks good', description: 'Proceed with this direction.', recommended: true },
  { id: 'revise', label: 'Needs revision', description: 'Adjust the work and bring back another pass.', recommended: false },
];

// --attach <file> is sugar for `artifact put` plus a link to the ask: the
// common case ("here is the evidence, decide") is one command. Up to four;
// ids are derived from the ask so two asks never fight over one artifact.
function attachFiles(workspaceDir: string, askId: string, title: string, flags: Flags): string[] {
  const files = multiFlagValues(flags, 'attach').map(String);
  if (files.length > 4) {
    console.error('--attach accepts up to 4 files');
    process.exit(1);
  }
  return files.map((file, index) => {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`--attach: ${resolved} not found`);
      process.exit(1);
    }
    const id = slugify(`${askId}-${index + 1}-${path.basename(resolved, path.extname(resolved))}`) || `${askId}-${index + 1}`;
    storeArtifact(workspaceDir, resolved, { id, title, kind: 'preview' });
    return id;
  });
}

// Says, once, what an ask is missing to be answerable with one tap. This is
// the incentive docs/hub.md describes: vague asks are accepted, and wait.
function warnAskShape(askId: string, manifest: { reason?: unknown; artifactIds: string[]; response: { recommendedBy: string } }, flags: Flags): void {
  if (booleanFlag(flags, 'json', false)) return;
  const missing: string[] = [];
  if (manifest.response.recommendedBy !== 'agent') missing.push('--recommended');
  if (!manifest.reason) missing.push('--reason');
  if (missing.length) console.error(`ask ${askId}: no ${missing.join(' or ')}; on the hub this waits for words instead of one tap`);
  if (!manifest.artifactIds.length) console.error(`ask ${askId}: no artifact attached; the human will answer from the prompt alone (--attach <file>)`);
}

function applyRecommended(options: (OptionSpec & { recommended?: boolean })[], flags: Flags, askId: string): { options: (OptionSpec & { recommended: boolean })[]; explicit: boolean } {
  const recommendedFlag = flagValue(flags, 'recommended');
  if (typeof recommendedFlag !== 'string') {
    return { options: options.map((o, i) => ({ ...o, recommended: o.recommended !== undefined ? o.recommended : i === 0 })), explicit: false };
  }
  if (!options.some((o) => o.id === recommendedFlag)) {
    console.error(`--recommended ${recommendedFlag} is not an option of ask ${askId}: ${options.map((o) => o.id).join(', ')}`);
    process.exit(1);
  }
  return { options: options.map((o) => ({ ...o, recommended: o.id === recommendedFlag })), explicit: true };
}

async function createAsk(baseDir: string, flags: Flags): Promise<void> {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const title = flagValue(flags, 'title');
  const prompt = flagValue(flags, 'prompt');

  if (!title || !prompt) {
    console.error('humanctl ask create requires --title and --prompt');
    process.exit(1);
  }

  const createdAt = nowIso();
  const askId = slugify(flagValue(flags, 'id', title as string)) || `ask-${Date.now()}`;
  const askDir = askDirectory(workspaceDir, askId);
  const manifestPath = askManifestPath(workspaceDir, askId);
  const existingManifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : undefined;
  const baseOptions = normalizeAskOptions(flags, existingManifest?.response?.options ?? []);
  const { options: normalizedOptions, explicit } = applyRecommended(baseOptions.length > 0 ? baseOptions : PLACEHOLDER_OPTIONS, flags, askId);
  // Only an explicit --recommended counts as the agent's default; the
  // placeholder or index-0 fallback is a convenience, not a decision.
  const recommendedBy = explicit || (existingManifest?.response?.recommendedBy === 'agent' && !hasFlag(flags, 'option')) ? 'agent' : 'implicit';
  const escalation = flagValue(flags, 'escalation', existingManifest?.escalation || 'ask');
  const status = flagValue(flags, 'status', escalation === 'block' ? 'blocked' : 'open');
  const artifactIds = [...parseIdList(flags, 'artifact'), ...attachFiles(workspaceDir, askId, String(title), flags)];
  const watchIds = parseIdList(flags, 'watch');
  const keepOrigin = existingManifest?.origin && !hasFlag(flags, 'session') && !hasFlag(flags, 'agent');

  ensureDir(askDir);
  const manifest = {
    id: askId,
    title,
    summary: flagValue(flags, 'summary', existingManifest?.summary || prompt),
    status,
    escalation,
    prompt,
    reason: flagValue(flags, 'reason', existingManifest?.reason),
    unblocks: flagValue(flags, 'unblocks', existingManifest?.unblocks),
    whyNow: flagValue(flags, 'why-now', existingManifest?.whyNow),
    ifIgnored: flagValue(flags, 'if-ignored', existingManifest?.ifIgnored),
    artifactIds,
    watchIds: watchIds.length > 0 ? watchIds : undefined,
    response: {
      type: 'single-select',
      recommendedBy,
      options: normalizedOptions,
    },
    origin: keepOrigin ? existingManifest.origin : originForWorkspace(workspaceDir, flags),
    createdAt: existingManifest?.createdAt || createdAt,
    updatedAt: createdAt,
  };

  writeJson(manifestPath, manifest);
  appendWorkspaceEvent(workspaceDir, existingManifest ? 'updated' : 'created', 'ask', askId, 'agent', {
    escalation,
    artifactIds,
    watchIds,
  });
  updateUiState(workspaceDir, {
    route: `/app?ask=${askId}`,
    selectedAskId: askId,
  });
  warnAskShape(askId, manifest, flags);

  const hubOutcome = await pushAsk(workspaceDir, manifest, flags);
  outputResult(
    {
      ok: true,
      ask: readJson(manifestPath),
      path: askDir,
      hub: hubOutcome,
    },
    flags,
    () => {
      console.log(`Ask ${askId} -> ${path.join('.humanctl', 'asks', askId)}`);
    }
  );
  reportHubOutcome(hubOutcome, flags);
}

async function updateAsk(baseDir: string, askId: string, flags: Flags): Promise<void> {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifestPath = askManifestPath(workspaceDir, askId);
  ensureObjectExists(manifestPath, 'Ask', askId);

  const existing = readJson(manifestPath);
  const updatedAt = nowIso();
  const nextOptions = normalizeAskOptions(flags, existing.response.options);
  const { options: normalizedOptions, explicit } = applyRecommended(nextOptions, flags, askId);
  const recommendedBy = explicit ? 'agent' : hasFlag(flags, 'option') ? 'implicit' : existing.response.recommendedBy || 'implicit';
  const attached = attachFiles(workspaceDir, askId, String(flagValue(flags, 'title', existing.title)), flags);
  const artifactIds = [...(hasFlag(flags, 'artifact') ? parseIdList(flags, 'artifact') : existing.artifactIds || []), ...attached];
  const watchIds = hasFlag(flags, 'watch') ? parseIdList(flags, 'watch') : existing.watchIds;
  const nextAsk = {
    ...existing,
    title: flagValue(flags, 'title', existing.title),
    summary: flagValue(flags, 'summary', existing.summary),
    status: flagValue(flags, 'status', existing.status),
    escalation: flagValue(flags, 'escalation', existing.escalation),
    prompt: flagValue(flags, 'prompt', existing.prompt),
    reason: flagValue(flags, 'reason', existing.reason),
    unblocks: flagValue(flags, 'unblocks', existing.unblocks),
    whyNow: flagValue(flags, 'why-now', existing.whyNow),
    ifIgnored: flagValue(flags, 'if-ignored', existing.ifIgnored),
    artifactIds,
    watchIds: watchIds && watchIds.length > 0 ? watchIds : undefined,
    response: {
      ...existing.response,
      recommendedBy,
      options: normalizedOptions,
      answer: booleanFlag(flags, 'clear-answer', false) ? undefined : existing.response.answer,
    },
    origin: existing.origin || originForWorkspace(workspaceDir, flags),
    updatedAt,
  };
  if (booleanFlag(flags, 'clear-answer', false)) { nextAsk.status = hasFlag(flags, 'status') ? nextAsk.status : 'open'; delete nextAsk.close; }

  writeJson(manifestPath, nextAsk);
  appendWorkspaceEvent(workspaceDir, 'updated', 'ask', askId, 'agent', {
    status: nextAsk.status,
    escalation: nextAsk.escalation,
  });
  updateUiState(workspaceDir, {
    route: `/app?ask=${askId}`,
    selectedAskId: askId,
  });
  warnAskShape(askId, nextAsk, flags);

  const hubOutcome = await pushAsk(workspaceDir, nextAsk, flags);
  outputResult(
    {
      ok: true,
      ask: readJson(manifestPath),
      path: askDirectory(workspaceDir, askId),
      hub: hubOutcome,
    },
    flags,
    () => {
      console.log(`Ask ${askId} updated.`);
    }
  );
  reportHubOutcome(hubOutcome, flags);
}

// The write itself is recordAnswer (bin/hub-commands.ts), shared with the
// hub write-back in `ask get --wait`, so both paths leave the same manifest,
// the same workspace event, and the same UI-state nudge. A local answer is
// then pushed so the hub's copy stops asking.
async function answerAskCommand(baseDir: string, askId: string, flags: Flags): Promise<void> {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  let manifest: Record<string, any>;
  try {
    manifest = recordAnswer(workspaceDir, askId, {
      choiceId: flagValue(flags, 'choice') as string | undefined,
      note: flagValue(flags, 'note') as string | undefined,
      via: 'local',
    });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  const answer = manifest.response.answer;
  const origin = manifest.origin || originForWorkspace(workspaceDir, flags);
  const hubOutcome = await hubSend('ask.answer', origin, {
    askId,
    choiceId: answer.choiceId === '__note__' ? undefined : answer.choiceId,
    note: answer.note,
    actor: 'human',
  }, flags);

  outputResult(
    {
      ok: true,
      ask: manifest,
      answer,
      hub: hubOutcome,
    },
    flags,
    () => {
      console.log(`Ask ${askId} answered.`);
    }
  );
  reportHubOutcome(hubOutcome, flags);
}

async function deleteAsk(baseDir: string, askId: string, flags: Flags): Promise<void> {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const askDir = askDirectory(workspaceDir, askId);
  const manifestPath = askManifestPath(workspaceDir, askId);
  ensureObjectExists(manifestPath, 'Ask', askId);
  const existing = readJson(manifestPath);

  fs.rmSync(askDir, { recursive: true, force: true });
  appendWorkspaceEvent(workspaceDir, 'deleted', 'ask', askId, 'agent', {
    title: existing.title,
  });
  updateUiState(workspaceDir, {
    route: '/app',
  });
  // The hub keeps its copy as a closed item in Recent rather than a live ask.
  const hubOutcome = await hubSend('ask.close', existing.origin || originForWorkspace(workspaceDir, flags), { askId, status: 'deleted' }, flags);

  outputResult(
    {
      ok: true,
      deleted: {
        type: 'ask',
        id: askId,
      },
      hub: hubOutcome,
    },
    flags,
    () => {
      console.log(`Ask ${askId} deleted.`);
    }
  );
  reportHubOutcome(hubOutcome, flags);
}

function listArtifacts(baseDir: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const artifacts = listArtifactsInWorkspace(workspaceDir);
  outputResult(artifacts, flags, (items: any[]) => {
    if (items.length === 0) {
      console.log('No artifacts.');
      return;
    }
    items.forEach((artifact) => {
      console.log(`${artifact.kind.padEnd(10)} ${artifact.id}  ${artifact.title}`);
    });
  });
}

function getArtifact(baseDir: string, artifactId: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const artifact = readArtifactRecord(workspaceDir, artifactId);
  outputResult(artifact, flags, (value: any) => {
    console.log(`${value.title} (${value.id})`);
    console.log(value.summary);
    console.log(value.contentPath);
  });
}

interface StoreArtifactOpts {
  id: string;
  kind?: unknown;
  title?: unknown;
  summary?: unknown;
  status?: unknown;
  labels?: string[];
  pinned?: boolean;
}

// Copies a file into the workspace as an artifact and writes its manifest.
// Shared by `artifact put` and `ask create --attach`.
function storeArtifact(workspaceDir: string, resolvedSource: string, opts: StoreArtifactOpts): Record<string, any> {
  const artifactId = opts.id;
  const renderType = renderTypeForPath(resolvedSource);
  const createdAt = nowIso();
  const artifactDir = artifactDirectory(workspaceDir, artifactId);
  const manifestPath = artifactManifestPath(workspaceDir, artifactId);
  const entry = artifactEntryName(resolvedSource);
  const existingManifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : undefined;

  ensureDir(artifactDir);
  if (existingManifest?.render?.entry && existingManifest.render.entry !== entry) {
    fs.rmSync(path.join(artifactDir, existingManifest.render.entry), { force: true });
  }
  fs.copyFileSync(resolvedSource, path.join(artifactDir, entry));

  const manifest = {
    id: artifactId,
    kind: opts.kind ?? existingManifest?.kind ?? 'preview',
    title: opts.title ?? existingManifest?.title ?? titleFromId(artifactId),
    summary: opts.summary ?? existingManifest?.summary ?? `Published from ${path.basename(resolvedSource)}`,
    status: opts.status ?? existingManifest?.status ?? 'active',
    labels: opts.labels && opts.labels.length > 0 ? opts.labels : existingManifest?.labels,
    pinned: opts.pinned ?? existingManifest?.pinned ?? false,
    render: {
      type: renderType,
      entry,
    },
    createdAt: existingManifest?.createdAt || createdAt,
    updatedAt: createdAt,
  };

  writeJson(manifestPath, manifest);
  appendWorkspaceEvent(workspaceDir, existingManifest ? 'updated' : 'published', 'artifact', artifactId, 'agent', {
    source: resolvedSource,
  });
  return manifest;
}

async function putArtifact(baseDir: string, sourceFile: string, flags: Flags): Promise<void> {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const resolvedSource = path.resolve(sourceFile);

  if (!fs.existsSync(resolvedSource)) {
    console.error(`Artifact source not found: ${resolvedSource}`);
    process.exit(1);
  }

  const defaultId = slugify(path.basename(resolvedSource, path.extname(resolvedSource))) || 'artifact';
  const artifactId = slugify(flagValue(flags, 'id', defaultId));
  const labels = parseIdList(flags, 'label');
  const manifest = storeArtifact(workspaceDir, resolvedSource, {
    id: artifactId,
    kind: flagValue(flags, 'kind'),
    title: flagValue(flags, 'title'),
    summary: flagValue(flags, 'summary'),
    status: flagValue(flags, 'status'),
    labels,
    pinned: hasFlag(flags, 'pin') ? booleanFlag(flags, 'pin', false) : undefined,
  });
  const artifactDir = artifactDirectory(workspaceDir, artifactId);
  updateUiState(workspaceDir, {
    route: `/app?artifact=${artifactId}`,
    selectedArtifactId: artifactId,
  });
  const hubOutcome = await pushArtifact(workspaceDir, artifactId, originForWorkspace(workspaceDir, flags), flags);

  outputResult(
    {
      ok: true,
      artifact: manifest,
      path: artifactDir,
      hub: hubOutcome,
    },
    flags,
    () => {
      console.log(`Artifact ${artifactId} -> ${path.join('.humanctl', 'artifacts', artifactId)}`);
    }
  );
  reportHubOutcome(hubOutcome, flags);
}

function deleteArtifact(baseDir: string, artifactId: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const artifactDir = artifactDirectory(workspaceDir, artifactId);
  const manifestPath = artifactManifestPath(workspaceDir, artifactId);
  ensureObjectExists(manifestPath, 'Artifact', artifactId);
  const existing = readJson(manifestPath);

  fs.rmSync(artifactDir, { recursive: true, force: true });
  appendWorkspaceEvent(workspaceDir, 'deleted', 'artifact', artifactId, 'agent', {
    title: existing.title,
  });
  updateUiState(workspaceDir, {
    route: '/app',
  });

  outputResult(
    {
      ok: true,
      deleted: {
        type: 'artifact',
        id: artifactId,
      },
    },
    flags,
    () => {
      console.log(`Artifact ${artifactId} deleted.`);
    }
  );
}

function listWatches(baseDir: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const watches = listWatchesInWorkspace(workspaceDir);
  outputResult(watches, flags, (items: any[]) => {
    if (items.length === 0) {
      console.log('No watches.');
      return;
    }
    items.forEach((watch) => {
      console.log(`${watch.status.padEnd(8)} ${watch.id}  ${watch.title}`);
    });
  });
}

function getWatch(baseDir: string, watchId: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifestPath = watchManifestPath(workspaceDir, watchId);
  ensureObjectExists(manifestPath, 'Watch', watchId);
  const watch = readJson(manifestPath);
  outputResult(watch, flags, (value: any) => {
    console.log(`${value.title} (${value.id})`);
    console.log(value.conditionSummary);
  });
}

function createWatch(baseDir: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const title = flagValue(flags, 'title');
  const conditionSummary = flagValue(flags, 'condition-summary', flagValue(flags, 'condition'));

  if (!title || !conditionSummary) {
    console.error('humanctl watch create requires --title and --condition-summary');
    process.exit(1);
  }

  const createdAt = nowIso();
  const watchId = slugify(flagValue(flags, 'id', title as string)) || `watch-${Date.now()}`;
  const watchDir = watchDirectory(workspaceDir, watchId);
  const manifest = {
    id: watchId,
    title,
    summary: flagValue(flags, 'summary', conditionSummary),
    status: flagValue(flags, 'status', 'active'),
    escalation: flagValue(flags, 'escalation', 'nudge'),
    kind: flagValue(flags, 'kind', 'presence'),
    conditionSummary,
    lastCheckedAt: flagValue(flags, 'last-checked-at'),
    nextCheckAt: flagValue(flags, 'next-check-at'),
    createdAt,
    updatedAt: createdAt,
  };

  ensureDir(watchDir);
  writeJson(watchManifestPath(workspaceDir, watchId), manifest);
  appendWorkspaceEvent(workspaceDir, 'watch_created', 'watch', watchId, 'agent', {
    escalation: manifest.escalation,
    kind: manifest.kind,
  });

  outputResult(
    {
      ok: true,
      watch: manifest,
      path: watchDir,
    },
    flags,
    () => {
      console.log(`Watch ${watchId} -> ${path.join('.humanctl', 'watches', watchId)}`);
    }
  );
}

function updateWatch(baseDir: string, watchId: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifestPath = watchManifestPath(workspaceDir, watchId);
  ensureObjectExists(manifestPath, 'Watch', watchId);
  const existing = readJson(manifestPath);
  const updatedAt = nowIso();
  const nextWatch = {
    ...existing,
    title: flagValue(flags, 'title', existing.title),
    summary: flagValue(flags, 'summary', existing.summary),
    status: flagValue(flags, 'status', existing.status),
    escalation: flagValue(flags, 'escalation', existing.escalation),
    kind: flagValue(flags, 'kind', existing.kind),
    conditionSummary: flagValue(flags, 'condition-summary', flagValue(flags, 'condition', existing.conditionSummary)),
    lastCheckedAt: flagValue(flags, 'last-checked-at', existing.lastCheckedAt),
    nextCheckAt: flagValue(flags, 'next-check-at', existing.nextCheckAt),
    updatedAt,
  };

  writeJson(manifestPath, nextWatch);
  appendWorkspaceEvent(workspaceDir, 'watch_updated', 'watch', watchId, 'agent', {
    status: nextWatch.status,
    escalation: nextWatch.escalation,
  });

  outputResult(
    {
      ok: true,
      watch: nextWatch,
      path: watchDirectory(workspaceDir, watchId),
    },
    flags,
    () => {
      console.log(`Watch ${watchId} updated.`);
    }
  );
}

function deleteWatch(baseDir: string, watchId: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const watchDir = watchDirectory(workspaceDir, watchId);
  const manifestPath = watchManifestPath(workspaceDir, watchId);
  ensureObjectExists(manifestPath, 'Watch', watchId);
  const existing = readJson(manifestPath);

  fs.rmSync(watchDir, { recursive: true, force: true });
  appendWorkspaceEvent(workspaceDir, 'watch_deleted', 'watch', watchId, 'agent', {
    title: existing.title,
  });

  outputResult(
    {
      ok: true,
      deleted: {
        type: 'watch',
        id: watchId,
      },
    },
    flags,
    () => {
      console.log(`Watch ${watchId} deleted.`);
    }
  );
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.md':
      return 'text/markdown; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
}

function serveDirectory(targetDir: string, port: number): void {
  const root = path.resolve(targetDir);
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url as string, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    let filePath = path.join(root, pathname === '/' ? 'index.html' : pathname);

    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });

  server.listen(port, () => {
    console.log(`Serving ${root}`);
    console.log(`http://localhost:${port}`);
  });
}

function openUrl(url: string): void {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const openerArgs =
    process.platform === 'win32'
      ? ['/c', 'start', '', url]
      : [url];

  const child = childProcess.spawn(opener, openerArgs, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (response) => {
          response.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - startedAt > timeoutMs) {
            reject(new Error(`Timed out waiting for ${url}`));
            return;
          }

          setTimeout(attempt, 500);
        });
    };

    attempt();
  });
}

function launchApp(baseDir: string, flags: Flags): void {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const appRoot = path.resolve(__dirname, '..');
  const appEntryPath = path.join(appRoot, 'src', 'app', 'app', 'page.tsx');

  if (!fs.existsSync(appEntryPath)) {
    console.error('humanctl app currently requires a source checkout with the local Next.js app.');
    process.exit(1);
  }

  const port = Number(flagValue(flags, 'port', '3000'));
  const routePath = String(flagValue(flags, 'path', '/app'));
  const url = `http://localhost:${Number.isFinite(port) ? port : 3000}${routePath}`;

  const child = childProcess.spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
    cwd: appRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      HUMANCTL_WORKSPACE_ROOT: workspaceDir,
    },
  });

  if (flagValue(flags, 'open', false)) {
    waitForServer(url)
      .then(() => openUrl(url))
      .catch((error: Error) => {
        console.error(error.message);
      });
  }

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

// ---- desktop-app bridge: drive the running app through its command registry ----
// `humanctl app list-commands`                 every registered command
// `humanctl app invoke <name> [--json '{}']`   invoke with raw JSON params
// `humanctl app <name> [--param value ...]`    sugar: flags become params,
//                                              coerced by the declared types
// Talks to the unix socket at ~/.humanctl/app.sock (see docs/commands.md).
// Commands marked direct (pure lib/ observations, plus note.post) fall back to
// in-process execution when the app is not running (source "cli-direct").
function coerceParamsFromFlags(name: string, flags: Flags): Record<string, unknown> | null {
  const { COMMANDS } = require('../lib/commands') as typeof import('../lib/commands');
  const decl = COMMANDS.find((c) => c.name === name);
  const schema = (decl && decl.params) || {};
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (key === 'json' && !schema.json) continue; // output flag, not a param
    const spec = schema[key];
    const raw = Array.isArray(value) ? value[value.length - 1] : value;
    if (!spec) {
      // Pass unknown flags through as-is; the registry rejects them honestly.
      params[key] = raw === true ? true : String(raw);
      continue;
    }
    if (spec.type === 'boolean') {
      params[key] = raw === true ? true : ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
    } else if (spec.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        console.error(`humanctl app ${name}: --${key} must be a number`);
        return null;
      }
      params[key] = n;
    } else if (spec.type === 'object') {
      try {
        params[key] = JSON.parse(String(raw));
      } catch {
        console.error(`humanctl app ${name}: --${key} must be valid JSON`);
        return null;
      }
    } else {
      params[key] = raw === true ? '' : String(raw);
    }
  }
  return params;
}

async function invokeAppCommand(name: string, params: unknown): Promise<{ result: Record<string, unknown>; via: string }> {
  const commands = require('../lib/commands') as typeof import('../lib/commands');
  const res = await commands.socketRequest(name, params);
  if (!res || res.transport !== 'unavailable') return { result: res, via: 'app' };
  // Nothing is listening on the socket. Direct-capable commands still answer
  // from disk; everything else needs the app and says so.
  const decl = commands.COMMANDS.find((c) => c.name === name);
  if (decl && decl.direct) {
    const result = await commands.createRegistry().invoke(name, params, { source: 'cli-direct' });
    return { result, via: 'cli-direct' };
  }
  return {
    result: { ok: false, error: 'humanctl desktop app is not running (start it with `npm run desktop` or open the installed app)' },
    via: 'none',
  };
}

async function runAppBridge(argv: string[]): Promise<void> {
  const commands = require('../lib/commands') as typeof import('../lib/commands');
  const sub = argv[0];

  if (sub === 'list-commands') {
    const { flags } = parseFlags(argv.slice(1));
    // Ask the running app first (its list is the live truth); fall back to the
    // local declarations, which are the same table by construction.
    const res = await commands.socketRequest('app.commands', {});
    const viaApp = !!(res && res.ok && Array.isArray(res.commands));
    const list = viaApp ? (res.commands as any[]) : commands.listCommands();
    if (booleanFlag(flags, 'json', false)) {
      console.log(JSON.stringify({ ok: true, app: viaApp, commands: list }, null, 2));
      return;
    }
    console.log(viaApp ? 'registered commands (from the running app):' : 'registered commands (app not running; local declarations):');
    for (const c of list) {
      const params = Object.entries(c.params || {}).map(([k, s]: [string, any]) => (s.required ? `${k}*` : k)).join(', ');
      console.log(`  ${c.kind === 'action' ? 'act' : 'obs'}  ${c.name.padEnd(18)} ${c.direct ? '      ' : '(app) '} ${c.desc}${params ? ` [${params}]` : ''}`);
    }
    return;
  }

  let name: string | undefined;
  let params: Record<string, unknown> = {};
  if (sub === 'invoke') {
    name = argv[1];
    if (!name) {
      console.error('humanctl app invoke requires a command name (see humanctl app list-commands)');
      process.exitCode = 1;
      return;
    }
    const { flags } = parseFlags(argv.slice(2));
    const raw = flagValue(flags, 'json');
    if (raw !== undefined && raw !== true) {
      try {
        params = JSON.parse(String(raw));
      } catch {
        console.error('humanctl app invoke: --json must be valid JSON');
        process.exitCode = 1;
        return;
      }
    }
  } else {
    name = sub;
    const { flags } = parseFlags(argv.slice(1));
    const coerced = coerceParamsFromFlags(name, flags);
    if (coerced === null) {
      process.exitCode = 1;
      return;
    }
    params = coerced;
  }

  const { result, via } = await invokeAppCommand(name as string, params);
  if (via === 'cli-direct') console.error('note: app not running; answered directly from disk (source cli-direct)');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result && result.ok !== false ? 0 : 1;
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  usage();
  process.exit(0);
}

if (command === 'init') {
  initWorkspace(args[1] || '.');
  process.exit(0);
}

// Async commands return from main() and let the event loop drain, so a hub
// push or a --wait poll finishes and process.exitCode (not process.exit) is
// what ends the process. A rejection is the one thing that must not vanish.
function runAsync(work: Promise<void>): void {
  work.catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

function main(): void {
if (command === 'note' || command === 'btw') {
  const { positionals, flags } = parseFlags(args.slice(1));
  const message = positionals.join(' ').trim();
  if (!message) {
    console.error('humanctl note requires a message, e.g. humanctl note --level review "PRs up, need a merge in ~5m"');
    process.exit(1);
  }
  // async: the note routes through the command registry; no hard exit here.
  runAsync(appendNote(message, flags));
  return;
}

if (command === 'span') {
  const { flags } = parseFlags(args.slice(1));
  // async: span routes through the command registry; no hard exit here.
  spanCommand(flags);
  return;
}

if (command === 'pulse') {
  const { flags } = parseFlags(args.slice(1));
  // Lazy require: pulse pulls in the session reader; keep every other command
  // free of that cost.
  const { runPulse } = require('../lib/pulse') as typeof import('../lib/pulse');
  runPulse({
    json: booleanFlag(flags, 'json', false),
    fresh: booleanFlag(flags, 'fresh', false),
    repo: flagValue(flags, 'repo') as string | undefined,
    lane: flagValue(flags, 'lane') as string | undefined,
    config: flagValue(flags, 'config') as string | undefined,
  }).then(
    // No process.exit here: a hard exit can truncate large --json output
    // before stdout flushes. Let the event loop drain instead.
    (code: number) => { process.exitCode = code; },
    (error: Error) => {
      console.error(`humanctl pulse failed: ${error.message}`);
      process.exitCode = 1;
    }
  );
  return;
}

if (command === 'status') {
  const { positionals, flags } = parseFlags(args.slice(1));
  statusWorkspace(positionals[0] || '.', flags);
  process.exit(0);
}

if (command === 'artifact') {
  const subcommand = args[1];
  const { positionals, flags } = parseFlags(args.slice(2));

  if (subcommand === 'put') {
    const sourceFile = positionals[0];
    if (!sourceFile) {
      console.error('humanctl artifact put requires a source file');
      process.exit(1);
    }

    runAsync(putArtifact(String(flagValue(flags, 'workspace', '.')), sourceFile, flags));
    return;
  }

  if (subcommand === 'list') {
    listArtifacts(String(flagValue(flags, 'workspace', '.')), flags);
    process.exit(0);
  }

  if (subcommand === 'get') {
    const artifactId = positionals[0];
    if (!artifactId) {
      console.error('humanctl artifact get requires an artifact id');
      process.exit(1);
    }

    getArtifact(String(flagValue(flags, 'workspace', '.')), artifactId, flags);
    process.exit(0);
  }

  if (subcommand === 'delete') {
    const artifactId = positionals[0];
    if (!artifactId) {
      console.error('humanctl artifact delete requires an artifact id');
      process.exit(1);
    }

    deleteArtifact(String(flagValue(flags, 'workspace', '.')), artifactId, flags);
    process.exit(0);
  }
}

if (command === 'ask') {
  const subcommand = args[1];
  const { positionals, flags } = parseFlags(args.slice(2));

  if (subcommand === 'create') {
    runAsync(createAsk(String(flagValue(flags, 'workspace', '.')), flags));
    return;
  }

  if (subcommand === 'list') {
    listAsks(String(flagValue(flags, 'workspace', '.')), flags);
    process.exit(0);
  }

  if (subcommand === 'get') {
    const askId = positionals[0];
    if (!askId) {
      console.error('humanctl ask get requires an ask id');
      process.exit(1);
    }

    if (booleanFlag(flags, 'wait', false)) {
      runAsync(waitForAnswer(String(flagValue(flags, 'workspace', '.')), askId, flags));
      return;
    }
    getAsk(String(flagValue(flags, 'workspace', '.')), askId, flags);
    process.exit(0);
  }

  if (subcommand === 'update') {
    const askId = positionals[0];
    if (!askId) {
      console.error('humanctl ask update requires an ask id');
      process.exit(1);
    }

    runAsync(updateAsk(String(flagValue(flags, 'workspace', '.')), askId, flags));
    return;
  }

  if (subcommand === 'answer') {
    const askId = positionals[0];
    if (!askId) {
      console.error('humanctl ask answer requires an ask id');
      process.exit(1);
    }

    runAsync(answerAskCommand(String(flagValue(flags, 'workspace', '.')), askId, flags));
    return;
  }

  if (subcommand === 'close') {
    const askId = positionals[0];
    if (!askId) {
      console.error('humanctl ask close requires an ask id');
      process.exit(1);
    }

    runAsync(closeAsk(String(flagValue(flags, 'workspace', '.')), askId, flags));
    return;
  }

  if (subcommand === 'delete') {
    const askId = positionals[0];
    if (!askId) {
      console.error('humanctl ask delete requires an ask id');
      process.exit(1);
    }

    runAsync(deleteAsk(String(flagValue(flags, 'workspace', '.')), askId, flags));
    return;
  }
}

if (command === 'hub') {
  // serve | config | push | status | token; see bin/hub-commands.ts and docs/hub.md.
  runAsync(runHubCommand(args.slice(1), parseFlags));
  return;
}

if (command === 'watch') {
  const subcommand = args[1];
  const { positionals, flags } = parseFlags(args.slice(2));

  if (subcommand === 'create') {
    createWatch(String(flagValue(flags, 'workspace', '.')), flags);
    process.exit(0);
  }

  if (subcommand === 'list') {
    listWatches(String(flagValue(flags, 'workspace', '.')), flags);
    process.exit(0);
  }

  if (subcommand === 'get') {
    const watchId = positionals[0];
    if (!watchId) {
      console.error('humanctl watch get requires a watch id');
      process.exit(1);
    }

    getWatch(String(flagValue(flags, 'workspace', '.')), watchId, flags);
    process.exit(0);
  }

  if (subcommand === 'update') {
    const watchId = positionals[0];
    if (!watchId) {
      console.error('humanctl watch update requires a watch id');
      process.exit(1);
    }

    updateWatch(String(flagValue(flags, 'workspace', '.')), watchId, flags);
    process.exit(0);
  }

  if (subcommand === 'delete') {
    const watchId = positionals[0];
    if (!watchId) {
      console.error('humanctl watch delete requires a watch id');
      process.exit(1);
    }

    deleteWatch(String(flagValue(flags, 'workspace', '.')), watchId, flags);
    process.exit(0);
  }
}

if (command === 'app') {
  // `humanctl app` predates the command registry and still launches the
  // legacy source-checkout workspace UI (see launchApp). The registry bridge
  // (`list-commands`, `invoke`, and direct command-name sugar) is layered onto
  // the same verb rather than a new one, per the brief; dispatch by whether
  // the first argument names a bridge verb or a registered command, and fall
  // through to the legacy launcher for anything else (including no args, so
  // `humanctl app` and `humanctl app <workspace-dir>` behave exactly as before).
  const { COMMANDS } = require('../lib/commands') as typeof import('../lib/commands');
  const sub = args[1];
  if (sub === 'list-commands' || sub === 'invoke' || COMMANDS.some((c) => c.name === sub)) {
    runAppBridge(args.slice(1));
    return;
  }
  const { positionals, flags } = parseFlags(args.slice(1));
  launchApp(positionals[0] || String(flagValue(flags, 'workspace', '.')), flags);
  return;
}

if (command === 'serve') {
  const targetDir = args[1] || '.';
  const portFlagIndex = args.indexOf('--port');
  const port = portFlagIndex >= 0 ? Number(args[portFlagIndex + 1]) : 4173;
  serveDirectory(targetDir, Number.isFinite(port) ? port : 4173);
  return;
}

usage();
process.exitCode = 1;
}

main();
