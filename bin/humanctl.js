#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

function usage() {
  console.log(`humanctl

Usage:
  humanctl init [dir]
  humanctl status [dir]
  humanctl artifact put <file> [--workspace dir] [--title text] [--summary text] [--kind preview]
  humanctl ask create [--workspace dir] --title text --prompt text [--summary text] [--artifact id]
    [--option "choice-id|Label|Description"] [--recommended choice-id] [--escalation ask]
  humanctl app [dir] [--port 3000] [--open] [--path /app]
  humanctl serve [dir] [--port 4173]
`);
}

function nowIso() {
  return new Date().toISOString();
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

function appendEvent(workspaceDir, event) {
  const eventsPath = path.join(workspaceDir, "inbox", "events.jsonl");
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
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

function statusWorkspace(baseDir) {
  const workspaceDir = ensureWorkspaceExists(baseDir);

  const manifest = readJson(path.join(workspaceDir, "manifest.json"));
  const asksDir = path.join(workspaceDir, "asks");
  const artifactsDir = path.join(workspaceDir, "artifacts");
  const watchesDir = path.join(workspaceDir, "watches");
  const inboxPath = path.join(workspaceDir, "inbox", "events.jsonl");

  const asks = fs.existsSync(asksDir)
    ? fs.readdirSync(asksDir).filter((entry) => fs.statSync(path.join(asksDir, entry)).isDirectory())
    : [];

  const artifacts = fs.existsSync(artifactsDir)
    ? fs.readdirSync(artifactsDir).filter((entry) => fs.statSync(path.join(artifactsDir, entry)).isDirectory())
    : [];

  const watches = fs.existsSync(watchesDir)
    ? fs.readdirSync(watchesDir).filter((entry) => fs.statSync(path.join(watchesDir, entry)).isDirectory())
    : [];

  const eventCount = fs.existsSync(inboxPath)
    ? fs.readFileSync(inboxPath, "utf8").split("\n").filter(Boolean).length
    : 0;

  console.log(`Workspace: ${manifest.name}`);
  console.log(`Path: ${workspaceDir}`);
  console.log(`Asks: ${asks.length}`);
  console.log(`Artifacts: ${artifacts.length}`);
  console.log(`Watches: ${watches.length}`);
  console.log(`Events: ${eventCount}`);
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
  const artifactDir = path.join(workspaceDir, "artifacts", artifactId);
  const manifestPath = path.join(artifactDir, "manifest.json");
  const entry = artifactEntryName(resolvedSource);
  const existingManifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : undefined;
  const labels = multiFlagValues(flags, "label")
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  ensureDir(artifactDir);
  fs.copyFileSync(resolvedSource, path.join(artifactDir, entry));

  const manifest = {
    id: artifactId,
    kind: flagValue(flags, "kind", existingManifest?.kind || "preview"),
    title: flagValue(flags, "title", existingManifest?.title || titleFromId(artifactId)),
    summary: flagValue(flags, "summary", existingManifest?.summary || `Published from ${path.basename(resolvedSource)}`),
    status: flagValue(flags, "status", existingManifest?.status || "active"),
    labels: labels.length > 0 ? labels : existingManifest?.labels,
    pinned: Boolean(flagValue(flags, "pin", existingManifest?.pinned || false)),
    render: {
      type: renderType,
      entry
    },
    createdAt: existingManifest?.createdAt || createdAt,
    updatedAt: createdAt
  };

  writeJson(manifestPath, manifest);

  appendEvent(workspaceDir, {
    id: `evt_${createdAt.replace(/\W/g, "").slice(-8)}`,
    ts: createdAt,
    kind: "published",
    target: {
      type: "artifact",
      id: artifactId
    },
    actor: "agent",
    payload: {
      source: resolvedSource
    }
  });

  updateUiState(workspaceDir, {
    route: `/app?artifact=${artifactId}`,
    selectedArtifactId: artifactId
  });

  console.log(`Artifact ${artifactId} -> ${path.join(".humanctl", "artifacts", artifactId)}`);
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
  const askDir = path.join(workspaceDir, "asks", askId);
  const manifestPath = path.join(askDir, "manifest.json");
  const existingManifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : undefined;
  const recommendedId = flagValue(flags, "recommended");
  const options = multiFlagValues(flags, "option").map(parseOptionSpec);

  if (options.length === 0) {
    options.push(
      { id: "looks-good", label: "Looks good", description: "Proceed with this direction." },
      { id: "revise", label: "Needs revision", description: "Adjust the work and bring back another pass." }
    );
  }

  const normalizedOptions = options.map((option) => ({
    ...option,
    recommended: recommendedId ? option.id === recommendedId : option.id === options[0].id
  }));
  const artifactIds = multiFlagValues(flags, "artifact")
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const watchIds = multiFlagValues(flags, "watch")
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const escalation = flagValue(flags, "escalation", existingManifest?.escalation || "ask");
  const status = escalation === "block" ? "blocked" : "open";

  ensureDir(askDir);
  writeJson(manifestPath, {
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
  });

  appendEvent(workspaceDir, {
    id: `evt_${createdAt.replace(/\W/g, "").slice(-8)}`,
    ts: createdAt,
    kind: "created",
    target: {
      type: "ask",
      id: askId
    },
    actor: "agent",
    payload: {
      escalation,
      artifactIds
    }
  });

  updateUiState(workspaceDir, {
    route: `/app?ask=${askId}`,
    selectedAskId: askId
  });

  console.log(`Ask ${askId} -> ${path.join(".humanctl", "asks", askId)}`);
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
  statusWorkspace(args[1] || ".");
  process.exit(0);
}

if (command === "artifact" && args[1] === "put") {
  const { positionals, flags } = parseFlags(args.slice(2));
  const sourceFile = positionals[0];

  if (!sourceFile) {
    console.error("humanctl artifact put requires a source file");
    process.exit(1);
  }

  putArtifact(flagValue(flags, "workspace", "."), sourceFile, flags);
  process.exit(0);
}

if (command === "ask" && args[1] === "create") {
  const { flags } = parseFlags(args.slice(2));
  createAsk(flagValue(flags, "workspace", "."), flags);
  process.exit(0);
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
