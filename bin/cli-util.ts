// Helpers shared by the humanctl CLI entry (bin/humanctl.ts) and the hub
// commands (bin/hub-commands.ts): flag parsing, JSON file IO, workspace paths,
// the workspace event log, and output formatting. Pure Node, no lib/ imports.

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

export type FlagValue = string | boolean;
export type Flags = Record<string, FlagValue | FlagValue[]>;

export function nowIso(): string {
  return new Date().toISOString();
}

export function eventId(): string {
  return `evt_${randomUUID().slice(0, 8)}`;
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeJson(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

export function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

export function workspaceDirFor(baseDir: string): string {
  return path.resolve(baseDir, '.humanctl');
}

export function ensureWorkspaceExists(baseDir: string): string {
  const workspaceDir = workspaceDirFor(baseDir);
  if (!fs.existsSync(workspaceDir)) {
    console.error(`No .humanctl workspace found in ${path.resolve(baseDir)}`);
    process.exit(1);
  }

  return workspaceDir;
}

export function askDirectory(workspaceDir: string, askId: string): string {
  return path.join(workspaceDir, 'asks', askId);
}

export function askManifestPath(workspaceDir: string, askId: string): string {
  return path.join(askDirectory(workspaceDir, askId), 'manifest.json');
}

export function artifactDirectory(workspaceDir: string, artifactId: string): string {
  return path.join(workspaceDir, 'artifacts', artifactId);
}

export function artifactManifestPath(workspaceDir: string, artifactId: string): string {
  return path.join(artifactDirectory(workspaceDir, artifactId), 'manifest.json');
}

export function watchDirectory(workspaceDir: string, watchId: string): string {
  return path.join(workspaceDir, 'watches', watchId);
}

export function watchManifestPath(workspaceDir: string, watchId: string): string {
  return path.join(watchDirectory(workspaceDir, watchId), 'manifest.json');
}

export function parseFlags(argv: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    const next = argv[index + 1];
    const value: FlagValue = next && !next.startsWith('--') ? next : true;

    if (value !== true) {
      index += 1;
    }

    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      const existing = flags[name];
      flags[name] = Array.isArray(existing) ? [...existing, value] : [existing as FlagValue, value];
      continue;
    }

    flags[name] = value;
  }

  return { positionals, flags };
}

export function hasFlag(flags: Flags, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(flags, name);
}

export function flagValue(flags: Flags, name: string, fallback?: FlagValue): FlagValue | undefined {
  const value = flags[name];

  if (Array.isArray(value)) {
    return value[value.length - 1];
  }

  if (value === undefined) {
    return fallback;
  }

  return value;
}

export function multiFlagValues(flags: Flags, name: string): FlagValue[] {
  const value = flags[name];

  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function booleanFlag(flags: Flags, name: string, fallback = false): boolean {
  if (!hasFlag(flags, name)) {
    return fallback;
  }

  const value = flagValue(flags, name, true);

  if (value === true) {
    return true;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function slugify(value: unknown): string {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function titleFromId(value: unknown): string {
  return String(value)
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function parseIdList(flags: Flags, name: string): string[] {
  return multiFlagValues(flags, name)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function appendEvent(workspaceDir: string, event: Record<string, unknown>): void {
  const eventsPath = path.join(workspaceDir, 'inbox', 'events.jsonl');
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
}

export function appendWorkspaceEvent(workspaceDir: string, kind: string, targetType: string, targetId: string, actor: string, payload: Record<string, unknown>): void {
  appendEvent(workspaceDir, {
    id: eventId(),
    ts: nowIso(),
    kind,
    target: {
      type: targetType,
      id: targetId,
    },
    actor,
    payload,
  });
}

export function renderTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.html':
      return 'html';
    case '.md':
      return 'markdown';
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
    case '.svg':
      return 'image';
    default:
      return 'file';
  }
}

export function artifactEntryName(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return `content${ext || '.txt'}`;
}

export interface OptionSpec {
  id: string;
  label: string;
  description: string;
}

export function parseOptionSpec(spec: unknown): OptionSpec {
  const [id, label, ...descriptionParts] = String(spec).split('|');
  const choiceLabel = label?.trim();

  if (!choiceLabel) {
    throw new Error(`Invalid --option "${spec}". Use "choice-id|Label|Description".`);
  }

  return {
    id: id?.trim() ? id.trim() : slugify(choiceLabel),
    label: choiceLabel,
    description: descriptionParts.join('|').trim() || choiceLabel,
  };
}

export function updateUiState(workspaceDir: string, nextState: Record<string, unknown>): void {
  const uiStatePath = path.join(workspaceDir, 'state', 'ui.json');
  let existing: Record<string, unknown> = {};

  if (fs.existsSync(uiStatePath)) {
    try {
      existing = readJson(uiStatePath);
    } catch {
      existing = {};
    }
  }

  writeJson(uiStatePath, {
    ...existing,
    ...nextState,
  });
}

export function outputResult(value: unknown, flags: Flags, formatter?: (value: any) => void): void {
  if (booleanFlag(flags, 'json', false)) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (formatter) {
    formatter(value);
    return;
  }

  if (typeof value === 'string') {
    console.log(value);
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

export function listDirectoryIds(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function ensureObjectExists(dirPath: string, label: string, objectId: string): void {
  if (!fs.existsSync(dirPath)) {
    console.error(`${label} ${objectId} not found.`);
    process.exit(1);
  }
}

