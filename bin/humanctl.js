#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { randomUUID } = require("crypto");
const { URL } = require("url");

function usage() {
  console.log(`humanctl

Usage:
  humanctl init [dir]
  humanctl status [dir]
  humanctl ask [dir] --title "..." --prompt "..." --option "id:Label:Description" [--option "..."] [--recommended id] [--summary "..."] [--details "..."] [--tab main] [--escalation ask|block|nudge|log]
  humanctl serve [dir] [--port 4173]
`);
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function appendEvent(workspaceDir, event) {
  const eventsPath = path.join(workspaceDir, "inbox", "events.jsonl");
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}

function requireWorkspace(workspaceDir) {
  if (!fs.existsSync(workspaceDir)) {
    console.error(`No .humanctl workspace found in ${path.dirname(workspaceDir)}`);
    process.exitCode = 1;
    return false;
  }

  return true;
}

function parseFlags(args) {
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    if (key === "option") {
      const current = Array.isArray(flags.option) ? flags.option : [];
      current.push(next);
      flags.option = current;
    } else {
      flags[key] = next;
    }

    index += 1;
  }

  return flags;
}

function parseOption(rawOption) {
  const parts = String(rawOption)
    .split(":")
    .map((part) => part.trim());

  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error(`Invalid --option value "${rawOption}". Use id:Label:Description.`);
  }

  const [id, label, ...descriptionParts] = parts;

  return {
    id,
    label,
    description: descriptionParts.join(":")
  };
}

function buildAskHtml({ title, prompt, options, details, recommendedOption }) {
  const optionMarkup = options
    .map((option) => {
      const recommendation = recommendedOption && recommendedOption.id === option.id ? "<strong>Recommended</strong>" : "";

      return `<article class="thing-choice">
      <h3>${escapeHtml(option.label)}</h3>
      <p>${escapeHtml(option.description)}</p>
      ${recommendation ? `<p>${recommendation}</p>` : ""}
    </article>`;
    })
    .join("\n");

  const detailsMarkup = details ? `<p>${escapeHtml(details)}</p>` : "";

  return `<section class="thing-stack">
  <p class="thing-kicker">Decision packet</p>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(prompt)}</p>
  <div class="thing-grid">
    ${optionMarkup}
  </div>
  ${detailsMarkup}
</section>
`;
}

function initWorkspace(baseDir) {
  const workspaceDir = path.resolve(baseDir, ".humanctl");
  const createdAt = nowIso();

  ensureDir(workspaceDir);
  ensureDir(path.join(workspaceDir, "inbox"));
  ensureDir(path.join(workspaceDir, "tabs", "main", "things"));
  ensureDir(path.join(workspaceDir, "artifacts"));
  ensureDir(path.join(workspaceDir, "state"));

  const manifestPath = path.join(workspaceDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    writeJson(manifestPath, {
      id: `workspace-${path.basename(path.resolve(baseDir))}`,
      name: path.basename(path.resolve(baseDir)),
      version: 1,
      createdAt,
      defaultTabId: "main"
    });
  }

  const tabManifestPath = path.join(workspaceDir, "tabs", "main", "manifest.json");
  if (!fs.existsSync(tabManifestPath)) {
    writeJson(tabManifestPath, {
      id: "main",
      title: "Main",
      description: "Primary shared work surface",
      createdAt,
      updatedAt: createdAt
    });
  }

  const eventsPath = path.join(workspaceDir, "inbox", "events.jsonl");
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, "", "utf8");
  }

  const uiStatePath = path.join(workspaceDir, "state", "ui.json");
  if (!fs.existsSync(uiStatePath)) {
    writeJson(uiStatePath, {
      tabs: {
        main: {
          selected: true
        }
      }
    });
  }

  console.log(`Initialized ${workspaceDir}`);
}

function statusWorkspace(baseDir) {
  const workspaceDir = path.resolve(baseDir, ".humanctl");
  if (!requireWorkspace(workspaceDir)) {
    process.exitCode = 1;
    return;
  }

  const manifest = readJson(path.join(workspaceDir, "manifest.json"));
  const tabsDir = path.join(workspaceDir, "tabs");
  const inboxPath = path.join(workspaceDir, "inbox", "events.jsonl");
  const artifactsDir = path.join(workspaceDir, "artifacts");

  const tabs = fs.existsSync(tabsDir)
    ? fs.readdirSync(tabsDir).filter((entry) => fs.statSync(path.join(tabsDir, entry)).isDirectory())
    : [];

  const eventCount = fs.existsSync(inboxPath)
    ? fs.readFileSync(inboxPath, "utf8").split("\n").filter(Boolean).length
    : 0;

  const artifactCount = fs.existsSync(artifactsDir)
    ? fs.readdirSync(artifactsDir).length
    : 0;

  console.log(`Workspace: ${manifest.name}`);
  console.log(`Path: ${workspaceDir}`);
  console.log(`Tabs: ${tabs.length} (${tabs.join(", ") || "none"})`);
  console.log(`Artifacts: ${artifactCount}`);
  console.log(`Events: ${eventCount}`);
}

function askWorkspace(baseDir, rawArgs) {
  const workspaceDir = path.resolve(baseDir, ".humanctl");
  if (!requireWorkspace(workspaceDir)) {
    process.exitCode = 1;
    return;
  }

  const flags = parseFlags(rawArgs);
  const title = typeof flags.title === "string" ? flags.title.trim() : "";
  const prompt = typeof flags.prompt === "string" ? flags.prompt.trim() : "";
  const summary = typeof flags.summary === "string" ? flags.summary.trim() : "";
  const details = typeof flags.details === "string" ? flags.details.trim() : "";
  const tabId = typeof flags.tab === "string" ? flags.tab.trim() || "main" : "main";
  const escalation = typeof flags.escalation === "string" ? flags.escalation.trim() || "ask" : "ask";
  const rawOptions = Array.isArray(flags.option) ? flags.option : [];

  if (!title) {
    console.error("Missing required flag: --title");
    process.exitCode = 1;
    return;
  }

  if (!prompt) {
    console.error("Missing required flag: --prompt");
    process.exitCode = 1;
    return;
  }

  if (rawOptions.length < 2) {
    console.error("Provide at least two --option values.");
    process.exitCode = 1;
    return;
  }

  if (!["log", "nudge", "ask", "block"].includes(escalation)) {
    console.error(`Invalid escalation "${escalation}". Use log, nudge, ask, or block.`);
    process.exitCode = 1;
    return;
  }

  let options;
  try {
    options = rawOptions.map(parseOption);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const optionIds = new Set();
  for (const option of options) {
    if (optionIds.has(option.id)) {
      console.error(`Duplicate option id "${option.id}".`);
      process.exitCode = 1;
      return;
    }
    optionIds.add(option.id);
  }

  const recommendedId = typeof flags.recommended === "string" ? flags.recommended.trim() : "";
  if (recommendedId && !optionIds.has(recommendedId)) {
    console.error(`Recommended option "${recommendedId}" does not match any --option id.`);
    process.exitCode = 1;
    return;
  }

  const thingIdBase = typeof flags.id === "string" ? flags.id.trim() : slugify(title);
  const thingId = thingIdBase || `ask-${Date.now()}`;
  const thingDir = path.join(workspaceDir, "tabs", tabId, "things", thingId);

  if (!fs.existsSync(path.join(workspaceDir, "tabs", tabId, "manifest.json"))) {
    console.error(`Tab "${tabId}" does not exist.`);
    process.exitCode = 1;
    return;
  }

  if (fs.existsSync(thingDir)) {
    console.error(`Thing "${thingId}" already exists in tab "${tabId}".`);
    process.exitCode = 1;
    return;
  }

  const createdAt = nowIso();
  const recommendedOption = recommendedId ? options.find((option) => option.id === recommendedId) : null;
  const manifest = {
    id: thingId,
    kind: "request",
    title,
    summary: summary || prompt,
    status: "open",
    escalation,
    render: {
      type: "html",
      entry: "content.html"
    },
    needsResponse: true,
    response: {
      type: "single-select",
      prompt,
      options: options.map((option) => ({
        ...option,
        recommended: option.id === recommendedId || undefined
      }))
    },
    createdAt,
    updatedAt: createdAt
  };

  ensureDir(thingDir);
  writeJson(path.join(thingDir, "manifest.json"), manifest);
  fs.writeFileSync(
    path.join(thingDir, "content.html"),
    buildAskHtml({ title, prompt, options, details, recommendedOption }),
    "utf8"
  );

  const event = {
    id: `evt_${randomUUID().slice(0, 8)}`,
    ts: createdAt,
    kind: "created",
    target: {
      tabId,
      thingId
    },
    actor: "agent",
    payload: {
      escalation,
      kind: "request"
    }
  };

  appendEvent(workspaceDir, event);

  const tabManifestPath = path.join(workspaceDir, "tabs", tabId, "manifest.json");
  const tabManifest = readJson(tabManifestPath);
  tabManifest.updatedAt = createdAt;
  writeJson(tabManifestPath, tabManifest);

  console.log(`Created ask ${thingId}`);
  console.log(`Path: ${thingDir}`);
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

if (command === "ask") {
  const baseDir = args[1] && !args[1].startsWith("--") ? args[1] : ".";
  const commandArgs = baseDir === "." && args[1] && args[1].startsWith("--") ? args.slice(1) : args.slice(2);
  askWorkspace(baseDir, commandArgs);
  process.exit(process.exitCode || 0);
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
