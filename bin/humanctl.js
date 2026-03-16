#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

function usage() {
  console.log(`humanctl

Usage:
  humanctl init [dir]
  humanctl status [dir]
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
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
  if (!fs.existsSync(workspaceDir)) {
    console.error(`No .humanctl workspace found in ${path.resolve(baseDir)}`);
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

if (command === "serve") {
  const targetDir = args[1] || ".";
  const portFlagIndex = args.indexOf("--port");
  const port = portFlagIndex >= 0 ? Number(args[portFlagIndex + 1]) : 4173;
  serveDirectory(targetDir, Number.isFinite(port) ? port : 4173);
  return;
}

usage();
process.exitCode = 1;
