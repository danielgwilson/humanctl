#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { randomUUID } = require("crypto");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

function usage() {
  console.log(`humanctl

Usage:
  humanctl init [dir]
  humanctl status [dir] [--json]

  humanctl ask create [--workspace dir] --title text --prompt text [--summary text] [--artifact id]
    [--watch id] [--option "choice-id|Label|Description"] [--recommended choice-id]
    [--escalation ask] [--why-now text] [--if-ignored text] [--status open] [--json]
  humanctl ask list [--workspace dir] [--json]
  humanctl ask get <id> [--workspace dir] [--json]
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
  humanctl serve [dir] [--port 4173]
`);
}

function nowIso() {
  return new Date().toISOString();
}

function eventId() {
  return `evt_${randomUUID().slice(0, 8)}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function workspaceDirFor(baseDir) {
  return path.resolve(baseDir, ".humanctl");
}

function ensureWorkspaceExists(baseDir) {
  const workspaceDir = workspaceDirFor(baseDir);
  if (!fs.existsSync(workspaceDir)) {
    console.error(`No .humanctl workspace found in ${path.resolve(baseDir)}`);
    process.exit(1);
  }

  return workspaceDir;
}

function askDirectory(workspaceDir, askId) {
  return path.join(workspaceDir, "asks", askId);
}

function askManifestPath(workspaceDir, askId) {
  return path.join(askDirectory(workspaceDir, askId), "manifest.json");
}

function artifactDirectory(workspaceDir, artifactId) {
  return path.join(workspaceDir, "artifacts", artifactId);
}

function artifactManifestPath(workspaceDir, artifactId) {
  return path.join(artifactDirectory(workspaceDir, artifactId), "manifest.json");
}

function watchDirectory(workspaceDir, watchId) {
  return path.join(workspaceDir, "watches", watchId);
}

function watchManifestPath(workspaceDir, watchId) {
  return path.join(watchDirectory(workspaceDir, watchId), "manifest.json");
}

function parseFlags(argv) {
  const positionals = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    const next = argv[index + 1];
    const value = next && !next.startsWith("--") ? next : true;

    if (value !== true) {
      index += 1;
    }

    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      flags[name] = Array.isArray(flags[name]) ? [...flags[name], value] : [flags[name], value];
      continue;
    }

    flags[name] = value;
  }

  return { positionals, flags };
}

function hasFlag(flags, name) {
  return Object.prototype.hasOwnProperty.call(flags, name);
}

function flagValue(flags, name, fallback) {
  const value = flags[name];

  if (Array.isArray(value)) {
    return value[value.length - 1];
  }

  if (value === undefined) {
    return fallback;
  }

  return value;
}

function multiFlagValues(flags, name) {
  const value = flags[name];

  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function booleanFlag(flags, name, fallback = false) {
  if (!hasFlag(flags, name)) {
    return fallback;
  }

  const value = flagValue(flags, name, true);

  if (value === true) {
    return true;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function titleFromId(value) {
  return String(value)
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseIdList(flags, name) {
  return multiFlagValues(flags, name)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function appendEvent(workspaceDir, event) {
  const eventsPath = path.join(workspaceDir, "inbox", "events.jsonl");
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}

function appendWorkspaceEvent(workspaceDir, kind, targetType, targetId, actor, payload) {
  appendEvent(workspaceDir, {
    id: eventId(),
    ts: nowIso(),
    kind,
    target: {
      type: targetType,
      id: targetId
    },
    actor,
    payload
  });
}

function renderTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".html":
      return "html";
    case ".md":
      return "markdown";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".webp":
    case ".svg":
      return "image";
    default:
      return "file";
  }
}

function artifactEntryName(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return `content${ext || ".txt"}`;
}

function parseOptionSpec(spec) {
  const [id, label, ...descriptionParts] = String(spec).split("|");
  const choiceLabel = label?.trim();

  if (!choiceLabel) {
    throw new Error(`Invalid --option "${spec}". Use "choice-id|Label|Description".`);
  }

  return {
    id: id?.trim() ? id.trim() : slugify(choiceLabel),
    label: choiceLabel,
    description: descriptionParts.join("|").trim() || choiceLabel
  };
}

function updateUiState(workspaceDir, nextState) {
  const uiStatePath = path.join(workspaceDir, "state", "ui.json");
  let existing = {};

  if (fs.existsSync(uiStatePath)) {
    try {
      existing = readJson(uiStatePath);
    } catch {
      existing = {};
    }
  }

  writeJson(uiStatePath, {
    ...existing,
    ...nextState
  });
}

function outputResult(value, flags, formatter) {
  if (booleanFlag(flags, "json", false)) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (formatter) {
    formatter(value);
    return;
  }

  if (typeof value === "string") {
    console.log(value);
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

function listDirectoryIds(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function ensureObjectExists(dirPath, label, objectId) {
  if (!fs.existsSync(dirPath)) {
    console.error(`${label} ${objectId} not found.`);
    process.exit(1);
  }
}

function askStatusRank(status) {
  switch (status) {
    case "blocked":
      return 0;
    case "open":
      return 1;
    case "draft":
      return 2;
    case "answered":
      return 3;
    case "snoozed":
      return 4;
    default:
      return 9;
  }
}

function watchStatusRank(status) {
  switch (status) {
    case "blocked":
      return 0;
    case "active":
      return 1;
    case "quiet":
      return 2;
    case "paused":
      return 3;
    case "done":
      return 4;
    default:
      return 9;
  }
}

function artifactRank(artifact) {
  return artifact.pinned ? 0 : 1;
}

function listAsksInWorkspace(workspaceDir) {
  return listDirectoryIds(path.join(workspaceDir, "asks"))
    .map((askId) => readJson(askManifestPath(workspaceDir, askId)))
    .sort((a, b) => {
      const rankDiff = askStatusRank(a.status) - askStatusRank(b.status);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function listArtifactsInWorkspace(workspaceDir) {
  return listDirectoryIds(path.join(workspaceDir, "artifacts"))
    .map((artifactId) => readJson(artifactManifestPath(workspaceDir, artifactId)))
    .sort((a, b) => {
      const rankDiff = artifactRank(a) - artifactRank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function listWatchesInWorkspace(workspaceDir) {
  return listDirectoryIds(path.join(workspaceDir, "watches"))
    .map((watchId) => readJson(watchManifestPath(workspaceDir, watchId)))
    .sort((a, b) => {
      const rankDiff = watchStatusRank(a.status) - watchStatusRank(b.status);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function readArtifactRecord(workspaceDir, artifactId) {
  const manifestPath = artifactManifestPath(workspaceDir, artifactId);
  ensureObjectExists(manifestPath, "Artifact", artifactId);
  const manifest = readJson(manifestPath);
  const contentPath = path.join(artifactDirectory(workspaceDir, artifactId), manifest.render.entry);

  return {
    ...manifest,
    contentPath,
    content: safeReadFile(contentPath)
  };
}

function workspaceSnapshot(baseDir) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifest = readJson(path.join(workspaceDir, "manifest.json"));
  const asks = listAsksInWorkspace(workspaceDir);
  const artifacts = listArtifactsInWorkspace(workspaceDir);
  const watches = listWatchesInWorkspace(workspaceDir);
  const eventsPath = path.join(workspaceDir, "inbox", "events.jsonl");
  const events = safeReadFile(eventsPath).split("\n").filter(Boolean);

  return {
    workspace: manifest,
    path: workspaceDir,
    counts: {
      asks: asks.length,
      artifacts: artifacts.length,
      watches: watches.length,
      events: events.length
    },
    topAskId: asks[0]?.id,
    topArtifactId: artifacts[0]?.id,
    topWatchId: watches[0]?.id
  };
}

function initWorkspace(baseDir) {
  const workspaceDir = workspaceDirFor(baseDir);
  const createdAt = nowIso();

  ensureDir(workspaceDir);
  ensureDir(path.join(workspaceDir, "inbox"));
  ensureDir(path.join(workspaceDir, "asks"));
  ensureDir(path.join(workspaceDir, "artifacts"));
  ensureDir(path.join(workspaceDir, "watches"));
  ensureDir(path.join(workspaceDir, "policies"));
  ensureDir(path.join(workspaceDir, "state"));

  const manifestPath = path.join(workspaceDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    writeJson(manifestPath, {
      id: `workspace-${path.basename(path.resolve(baseDir))}`,
      name: path.basename(path.resolve(baseDir)),
      version: 2,
      createdAt
    });
  }

  const eventsPath = path.join(workspaceDir, "inbox", "events.jsonl");
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, "", "utf8");
  }

  const defaultPolicyPath = path.join(workspaceDir, "policies", "default.json");
  if (!fs.existsSync(defaultPolicyPath)) {
    writeJson(defaultPolicyPath, {
      id: "default",
      allowedChannels: ["inbox", "desktop", "focus-app"],
      quietHours: {
        start: "22:00",
        end: "08:00"
      },
      voiceAllowed: false,
      coalesceWindowSeconds: 300
    });
  }

  const uiStatePath = path.join(workspaceDir, "state", "ui.json");
  if (!fs.existsSync(uiStatePath)) {
    writeJson(uiStatePath, {
      route: "/app"
    });
  }

  console.log(`Initialized ${workspaceDir}`);
}

function statusWorkspace(baseDir, flags) {
  const snapshot = workspaceSnapshot(baseDir);
  outputResult(snapshot, flags, (value) => {
    console.log(`Workspace: ${value.workspace.name}`);
    console.log(`Path: ${value.path}`);
    console.log(`Asks: ${value.counts.asks}`);
    console.log(`Artifacts: ${value.counts.artifacts}`);
    console.log(`Watches: ${value.counts.watches}`);
    console.log(`Events: ${value.counts.events}`);
  });
}

function listAsks(baseDir, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const asks = listAsksInWorkspace(workspaceDir);
  outputResult(asks, flags, (items) => {
    if (items.length === 0) {
      console.log("No asks.");
      return;
    }
    items.forEach((ask) => {
      console.log(`${ask.status.padEnd(8)} ${ask.id}  ${ask.title}`);
    });
  });
}

function getAsk(baseDir, askId, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifestPath = askManifestPath(workspaceDir, askId);
  ensureObjectExists(manifestPath, "Ask", askId);
  const ask = readJson(manifestPath);
  outputResult(ask, flags, (value) => {
    console.log(`${value.title} (${value.id})`);
    console.log(value.prompt);
  });
}

function normalizeAskOptions(flags, existingOptions) {
  if (!hasFlag(flags, "option")) {
    return existingOptions;
  }

  const options = multiFlagValues(flags, "option").map(parseOptionSpec);
  if (options.length === 0) {
    return existingOptions;
  }

  const recommendedId = flagValue(flags, "recommended");
  return options.map((option, index) => ({
    ...option,
    recommended: recommendedId ? option.id === recommendedId : index === 0
  }));
}

function createAsk(baseDir, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const title = flagValue(flags, "title");
  const prompt = flagValue(flags, "prompt");

  if (!title || !prompt) {
    console.error("humanctl ask create requires --title and --prompt");
    process.exit(1);
  }

  const createdAt = nowIso();
  const askId = slugify(flagValue(flags, "id", title)) || `ask-${Date.now()}`;
  const askDir = askDirectory(workspaceDir, askId);
  const manifestPath = askManifestPath(workspaceDir, askId);
  const existingManifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : undefined;
  const options = normalizeAskOptions(flags, existingManifest?.response?.options ?? []);
  const normalizedOptions =
    options.length > 0
      ? options
      : [
          { id: "looks-good", label: "Looks good", description: "Proceed with this direction.", recommended: true },
          { id: "revise", label: "Needs revision", description: "Adjust the work and bring back another pass." }
        ];
  const escalation = flagValue(flags, "escalation", existingManifest?.escalation || "ask");
  const status = flagValue(flags, "status", escalation === "block" ? "blocked" : "open");
  const artifactIds = parseIdList(flags, "artifact");
  const watchIds = parseIdList(flags, "watch");

  ensureDir(askDir);
  const manifest = {
    id: askId,
    title,
    summary: flagValue(flags, "summary", existingManifest?.summary || prompt),
    status,
    escalation,
    prompt,
    whyNow: flagValue(flags, "why-now", existingManifest?.whyNow),
    ifIgnored: flagValue(flags, "if-ignored", existingManifest?.ifIgnored),
    artifactIds,
    watchIds: watchIds.length > 0 ? watchIds : undefined,
    response: {
      type: "single-select",
      options: normalizedOptions
    },
    createdAt: existingManifest?.createdAt || createdAt,
    updatedAt: createdAt
  };

  writeJson(manifestPath, manifest);
  appendWorkspaceEvent(workspaceDir, existingManifest ? "updated" : "created", "ask", askId, "agent", {
    escalation,
    artifactIds,
    watchIds
  });
  updateUiState(workspaceDir, {
    route: `/app?ask=${askId}`,
    selectedAskId: askId
  });

  outputResult(
    {
      ok: true,
      ask: manifest,
      path: askDir
    },
    flags,
    () => {
      console.log(`Ask ${askId} -> ${path.join(".humanctl", "asks", askId)}`);
    }
  );
}

function updateAsk(baseDir, askId, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifestPath = askManifestPath(workspaceDir, askId);
  ensureObjectExists(manifestPath, "Ask", askId);

  const existing = readJson(manifestPath);
  const updatedAt = nowIso();
  const nextOptions = normalizeAskOptions(flags, existing.response.options);
  const recommendedId = flagValue(flags, "recommended");
  const normalizedOptions = nextOptions.map((option, index) => ({
    ...option,
    recommended:
      recommendedId !== undefined
        ? option.id === recommendedId
        : option.recommended !== undefined
          ? option.recommended
          : index === 0
  }));
  const artifactIds = hasFlag(flags, "artifact") ? parseIdList(flags, "artifact") : existing.artifactIds;
  const watchIds = hasFlag(flags, "watch") ? parseIdList(flags, "watch") : existing.watchIds;
  const nextAsk = {
    ...existing,
    title: flagValue(flags, "title", existing.title),
    summary: flagValue(flags, "summary", existing.summary),
    status: flagValue(flags, "status", existing.status),
    escalation: flagValue(flags, "escalation", existing.escalation),
    prompt: flagValue(flags, "prompt", existing.prompt),
    whyNow: flagValue(flags, "why-now", existing.whyNow),
    ifIgnored: flagValue(flags, "if-ignored", existing.ifIgnored),
    artifactIds,
    watchIds: watchIds && watchIds.length > 0 ? watchIds : undefined,
    response: {
      ...existing.response,
      options: normalizedOptions,
      answer: booleanFlag(flags, "clear-answer", false) ? undefined : existing.response.answer
    },
    updatedAt
  };

  writeJson(manifestPath, nextAsk);
  appendWorkspaceEvent(workspaceDir, "updated", "ask", askId, "agent", {
    status: nextAsk.status,
    escalation: nextAsk.escalation
  });
  updateUiState(workspaceDir, {
    route: `/app?ask=${askId}`,
    selectedAskId: askId
  });

  outputResult(
    {
      ok: true,
      ask: nextAsk,
      path: askDirectory(workspaceDir, askId)
    },
    flags,
    () => {
      console.log(`Ask ${askId} updated.`);
    }
  );
}

function answerAskCommand(baseDir, askId, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifestPath = askManifestPath(workspaceDir, askId);
  ensureObjectExists(manifestPath, "Ask", askId);

  const manifest = readJson(manifestPath);
  const choiceId = flagValue(flags, "choice");
  const note = flagValue(flags, "note");
  const cleanedNote = note?.trim() ? note.trim() : undefined;
  const resolvedChoiceId = choiceId?.trim() ? choiceId.trim() : "__note__";

  if (!choiceId?.trim() && !cleanedNote) {
    console.error(`Ask ${askId} requires either --choice or --note.`);
    process.exit(1);
  }

  if (choiceId?.trim() && !manifest.response.options.find((option) => option.id === resolvedChoiceId)) {
    console.error(`Choice ${resolvedChoiceId} is not valid for ask ${askId}.`);
    process.exit(1);
  }

  const answeredAt = nowIso();
  manifest.status = "answered";
  manifest.updatedAt = answeredAt;
  manifest.response.answer = {
    choiceId: resolvedChoiceId,
    note: cleanedNote,
    answeredAt,
    actor: "human"
  };

  writeJson(manifestPath, manifest);
  appendWorkspaceEvent(workspaceDir, "answered", "ask", askId, "human", {
    choiceId: resolvedChoiceId,
    note: cleanedNote
  });
  updateUiState(workspaceDir, {
    route: `/app?ask=${askId}`,
    selectedAskId: askId
  });

  outputResult(
    {
      ok: true,
      ask: manifest,
      answer: manifest.response.answer
    },
    flags,
    () => {
      console.log(`Ask ${askId} answered.`);
    }
  );
}

function deleteAsk(baseDir, askId, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const askDir = askDirectory(workspaceDir, askId);
  const manifestPath = askManifestPath(workspaceDir, askId);
  ensureObjectExists(manifestPath, "Ask", askId);
  const existing = readJson(manifestPath);

  fs.rmSync(askDir, { recursive: true, force: true });
  appendWorkspaceEvent(workspaceDir, "deleted", "ask", askId, "agent", {
    title: existing.title
  });
  updateUiState(workspaceDir, {
    route: "/app"
  });

  outputResult(
    {
      ok: true,
      deleted: {
        type: "ask",
        id: askId
      }
    },
    flags,
    () => {
      console.log(`Ask ${askId} deleted.`);
    }
  );
}

function listArtifacts(baseDir, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const artifacts = listArtifactsInWorkspace(workspaceDir);
  outputResult(artifacts, flags, (items) => {
    if (items.length === 0) {
      console.log("No artifacts.");
      return;
    }
    items.forEach((artifact) => {
      console.log(`${artifact.kind.padEnd(10)} ${artifact.id}  ${artifact.title}`);
    });
  });
}

function getArtifact(baseDir, artifactId, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const artifact = readArtifactRecord(workspaceDir, artifactId);
  outputResult(artifact, flags, (value) => {
    console.log(`${value.title} (${value.id})`);
    console.log(value.summary);
    console.log(value.contentPath);
  });
}

function putArtifact(baseDir, sourceFile, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const resolvedSource = path.resolve(sourceFile);

  if (!fs.existsSync(resolvedSource)) {
    console.error(`Artifact source not found: ${resolvedSource}`);
    process.exit(1);
  }

  const renderType = renderTypeForPath(resolvedSource);
  const defaultId = slugify(path.basename(resolvedSource, path.extname(resolvedSource))) || "artifact";
  const artifactId = slugify(flagValue(flags, "id", defaultId));
  const createdAt = nowIso();
  const artifactDir = artifactDirectory(workspaceDir, artifactId);
  const manifestPath = artifactManifestPath(workspaceDir, artifactId);
  const entry = artifactEntryName(resolvedSource);
  const existingManifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : undefined;
  const labels = parseIdList(flags, "label");

  ensureDir(artifactDir);
  if (existingManifest?.render?.entry && existingManifest.render.entry !== entry) {
    fs.rmSync(path.join(artifactDir, existingManifest.render.entry), { force: true });
  }
  fs.copyFileSync(resolvedSource, path.join(artifactDir, entry));

  const manifest = {
    id: artifactId,
    kind: flagValue(flags, "kind", existingManifest?.kind || "preview"),
    title: flagValue(flags, "title", existingManifest?.title || titleFromId(artifactId)),
    summary: flagValue(flags, "summary", existingManifest?.summary || `Published from ${path.basename(resolvedSource)}`),
    status: flagValue(flags, "status", existingManifest?.status || "active"),
    labels: labels.length > 0 ? labels : existingManifest?.labels,
    pinned: booleanFlag(flags, "pin", existingManifest?.pinned || false),
    render: {
      type: renderType,
      entry
    },
    createdAt: existingManifest?.createdAt || createdAt,
    updatedAt: createdAt
  };

  writeJson(manifestPath, manifest);
  appendWorkspaceEvent(workspaceDir, existingManifest ? "updated" : "published", "artifact", artifactId, "agent", {
    source: resolvedSource
  });
  updateUiState(workspaceDir, {
    route: `/app?artifact=${artifactId}`,
    selectedArtifactId: artifactId
  });

  outputResult(
    {
      ok: true,
      artifact: manifest,
      path: artifactDir
    },
    flags,
    () => {
      console.log(`Artifact ${artifactId} -> ${path.join(".humanctl", "artifacts", artifactId)}`);
    }
  );
}

function deleteArtifact(baseDir, artifactId, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const artifactDir = artifactDirectory(workspaceDir, artifactId);
  const manifestPath = artifactManifestPath(workspaceDir, artifactId);
  ensureObjectExists(manifestPath, "Artifact", artifactId);
  const existing = readJson(manifestPath);

  fs.rmSync(artifactDir, { recursive: true, force: true });
  appendWorkspaceEvent(workspaceDir, "deleted", "artifact", artifactId, "agent", {
    title: existing.title
  });
  updateUiState(workspaceDir, {
    route: "/app"
  });

  outputResult(
    {
      ok: true,
      deleted: {
        type: "artifact",
        id: artifactId
      }
    },
    flags,
    () => {
      console.log(`Artifact ${artifactId} deleted.`);
    }
  );
}

function listWatches(baseDir, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const watches = listWatchesInWorkspace(workspaceDir);
  outputResult(watches, flags, (items) => {
    if (items.length === 0) {
      console.log("No watches.");
      return;
    }
    items.forEach((watch) => {
      console.log(`${watch.status.padEnd(8)} ${watch.id}  ${watch.title}`);
    });
  });
}

function getWatch(baseDir, watchId, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifestPath = watchManifestPath(workspaceDir, watchId);
  ensureObjectExists(manifestPath, "Watch", watchId);
  const watch = readJson(manifestPath);
  outputResult(watch, flags, (value) => {
    console.log(`${value.title} (${value.id})`);
    console.log(value.conditionSummary);
  });
}

function createWatch(baseDir, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const title = flagValue(flags, "title");
  const conditionSummary = flagValue(flags, "condition-summary", flagValue(flags, "condition"));

  if (!title || !conditionSummary) {
    console.error("humanctl watch create requires --title and --condition-summary");
    process.exit(1);
  }

  const createdAt = nowIso();
  const watchId = slugify(flagValue(flags, "id", title)) || `watch-${Date.now()}`;
  const watchDir = watchDirectory(workspaceDir, watchId);
  const manifest = {
    id: watchId,
    title,
    summary: flagValue(flags, "summary", conditionSummary),
    status: flagValue(flags, "status", "active"),
    escalation: flagValue(flags, "escalation", "nudge"),
    kind: flagValue(flags, "kind", "presence"),
    conditionSummary,
    lastCheckedAt: flagValue(flags, "last-checked-at"),
    nextCheckAt: flagValue(flags, "next-check-at"),
    createdAt,
    updatedAt: createdAt
  };

  ensureDir(watchDir);
  writeJson(watchManifestPath(workspaceDir, watchId), manifest);
  appendWorkspaceEvent(workspaceDir, "watch_created", "watch", watchId, "agent", {
    escalation: manifest.escalation,
    kind: manifest.kind
  });

  outputResult(
    {
      ok: true,
      watch: manifest,
      path: watchDir
    },
    flags,
    () => {
      console.log(`Watch ${watchId} -> ${path.join(".humanctl", "watches", watchId)}`);
    }
  );
}

function updateWatch(baseDir, watchId, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const manifestPath = watchManifestPath(workspaceDir, watchId);
  ensureObjectExists(manifestPath, "Watch", watchId);
  const existing = readJson(manifestPath);
  const updatedAt = nowIso();
  const nextWatch = {
    ...existing,
    title: flagValue(flags, "title", existing.title),
    summary: flagValue(flags, "summary", existing.summary),
    status: flagValue(flags, "status", existing.status),
    escalation: flagValue(flags, "escalation", existing.escalation),
    kind: flagValue(flags, "kind", existing.kind),
    conditionSummary: flagValue(flags, "condition-summary", flagValue(flags, "condition", existing.conditionSummary)),
    lastCheckedAt: flagValue(flags, "last-checked-at", existing.lastCheckedAt),
    nextCheckAt: flagValue(flags, "next-check-at", existing.nextCheckAt),
    updatedAt
  };

  writeJson(manifestPath, nextWatch);
  appendWorkspaceEvent(workspaceDir, "watch_updated", "watch", watchId, "agent", {
    status: nextWatch.status,
    escalation: nextWatch.escalation
  });

  outputResult(
    {
      ok: true,
      watch: nextWatch,
      path: watchDirectory(workspaceDir, watchId)
    },
    flags,
    () => {
      console.log(`Watch ${watchId} updated.`);
    }
  );
}

function deleteWatch(baseDir, watchId, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const watchDir = watchDirectory(workspaceDir, watchId);
  const manifestPath = watchManifestPath(workspaceDir, watchId);
  ensureObjectExists(manifestPath, "Watch", watchId);
  const existing = readJson(manifestPath);

  fs.rmSync(watchDir, { recursive: true, force: true });
  appendWorkspaceEvent(workspaceDir, "watch_deleted", "watch", watchId, "agent", {
    title: existing.title
  });

  outputResult(
    {
      ok: true,
      deleted: {
        type: "watch",
        id: watchId
      }
    },
    flags,
    () => {
      console.log(`Watch ${watchId} deleted.`);
    }
  );
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".md":
      return "text/markdown; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}

function serveDirectory(targetDir, port) {
  const root = path.resolve(targetDir);
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    let filePath = path.join(root, pathname === "/" ? "index.html" : pathname);

    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": getMimeType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });

  server.listen(port, () => {
    console.log(`Serving ${root}`);
    console.log(`http://localhost:${port}`);
  });
}

function openUrl(url) {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const openerArgs =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

  const child = childProcess.spawn(opener, openerArgs, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (response) => {
          response.resume();
          resolve();
        })
        .on("error", () => {
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

function launchApp(baseDir, flags) {
  const workspaceDir = ensureWorkspaceExists(baseDir);
  const appRoot = path.resolve(__dirname, "..");
  const appEntryPath = path.join(appRoot, "src", "app", "app", "page.tsx");

  if (!fs.existsSync(appEntryPath)) {
    console.error("humanctl app currently requires a source checkout with the local Next.js app.");
    process.exit(1);
  }

  const port = Number(flagValue(flags, "port", 3000));
  const routePath = String(flagValue(flags, "path", "/app"));
  const url = `http://localhost:${Number.isFinite(port) ? port : 3000}${routePath}`;

  const child = childProcess.spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: appRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      HUMANCTL_WORKSPACE_ROOT: workspaceDir
    }
  });

  if (flagValue(flags, "open", false)) {
    waitForServer(url)
      .then(() => openUrl(url))
      .catch((error) => {
        console.error(error.message);
      });
  }

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  usage();
  process.exit(0);
}

if (command === "init") {
  initWorkspace(args[1] || ".");
  process.exit(0);
}

if (command === "status") {
  const { positionals, flags } = parseFlags(args.slice(1));
  statusWorkspace(positionals[0] || ".", flags);
  process.exit(0);
}

if (command === "artifact") {
  const subcommand = args[1];
  const { positionals, flags } = parseFlags(args.slice(2));

  if (subcommand === "put") {
    const sourceFile = positionals[0];
    if (!sourceFile) {
      console.error("humanctl artifact put requires a source file");
      process.exit(1);
    }

    putArtifact(flagValue(flags, "workspace", "."), sourceFile, flags);
    process.exit(0);
  }

  if (subcommand === "list") {
    listArtifacts(flagValue(flags, "workspace", "."), flags);
    process.exit(0);
  }

  if (subcommand === "get") {
    const artifactId = positionals[0];
    if (!artifactId) {
      console.error("humanctl artifact get requires an artifact id");
      process.exit(1);
    }

    getArtifact(flagValue(flags, "workspace", "."), artifactId, flags);
    process.exit(0);
  }

  if (subcommand === "delete") {
    const artifactId = positionals[0];
    if (!artifactId) {
      console.error("humanctl artifact delete requires an artifact id");
      process.exit(1);
    }

    deleteArtifact(flagValue(flags, "workspace", "."), artifactId, flags);
    process.exit(0);
  }
}

if (command === "ask") {
  const subcommand = args[1];
  const { positionals, flags } = parseFlags(args.slice(2));

  if (subcommand === "create") {
    createAsk(flagValue(flags, "workspace", "."), flags);
    process.exit(0);
  }

  if (subcommand === "list") {
    listAsks(flagValue(flags, "workspace", "."), flags);
    process.exit(0);
  }

  if (subcommand === "get") {
    const askId = positionals[0];
    if (!askId) {
      console.error("humanctl ask get requires an ask id");
      process.exit(1);
    }

    getAsk(flagValue(flags, "workspace", "."), askId, flags);
    process.exit(0);
  }

  if (subcommand === "update") {
    const askId = positionals[0];
    if (!askId) {
      console.error("humanctl ask update requires an ask id");
      process.exit(1);
    }

    updateAsk(flagValue(flags, "workspace", "."), askId, flags);
    process.exit(0);
  }

  if (subcommand === "answer") {
    const askId = positionals[0];
    if (!askId) {
      console.error("humanctl ask answer requires an ask id");
      process.exit(1);
    }

    answerAskCommand(flagValue(flags, "workspace", "."), askId, flags);
    process.exit(0);
  }

  if (subcommand === "delete") {
    const askId = positionals[0];
    if (!askId) {
      console.error("humanctl ask delete requires an ask id");
      process.exit(1);
    }

    deleteAsk(flagValue(flags, "workspace", "."), askId, flags);
    process.exit(0);
  }
}

if (command === "watch") {
  const subcommand = args[1];
  const { positionals, flags } = parseFlags(args.slice(2));

  if (subcommand === "create") {
    createWatch(flagValue(flags, "workspace", "."), flags);
    process.exit(0);
  }

  if (subcommand === "list") {
    listWatches(flagValue(flags, "workspace", "."), flags);
    process.exit(0);
  }

  if (subcommand === "get") {
    const watchId = positionals[0];
    if (!watchId) {
      console.error("humanctl watch get requires a watch id");
      process.exit(1);
    }

    getWatch(flagValue(flags, "workspace", "."), watchId, flags);
    process.exit(0);
  }

  if (subcommand === "update") {
    const watchId = positionals[0];
    if (!watchId) {
      console.error("humanctl watch update requires a watch id");
      process.exit(1);
    }

    updateWatch(flagValue(flags, "workspace", "."), watchId, flags);
    process.exit(0);
  }

  if (subcommand === "delete") {
    const watchId = positionals[0];
    if (!watchId) {
      console.error("humanctl watch delete requires a watch id");
      process.exit(1);
    }

    deleteWatch(flagValue(flags, "workspace", "."), watchId, flags);
    process.exit(0);
  }
}

if (command === "app") {
  const { positionals, flags } = parseFlags(args.slice(1));
  launchApp(positionals[0] || flagValue(flags, "workspace", "."), flags);
  return;
}

if (command === "serve") {
  const targetDir = args[1] || ".";
  const portFlagIndex = args.indexOf("--port");
  const port = portFlagIndex >= 0 ? Number(args[portFlagIndex + 1]) : 4173;
  serveDirectory(targetDir, Number.isFinite(port) ? port : 4173);
  return;
}

usage();
process.exitCode = 1;
