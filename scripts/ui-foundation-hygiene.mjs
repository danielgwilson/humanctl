#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// The default is encoded so the prohibited source name never appears in a
// tracked Humanctl file. Additional names may be supplied at invocation time.
const DEFAULT_NAME_BASE64 = "YXR0aW8=";

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".graphql",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".jsonc",
  ".less",
  ".lock",
  ".md",
  ".mdx",
  ".mjs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const TEXT_BASENAMES = new Set([
  ".gitignore",
  ".npmignore",
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "NOTICE",
  "README",
]);

function usage() {
  console.log(`Usage: node scripts/ui-foundation-hygiene.mjs [options]

Options:
  --root <path>       repository root (defaults to git root)
  --forbid <name>     add a case-insensitive prohibited name; repeatable
  --selftest          run the built-in positive and negative cases
  --help              show this help

Environment:
  HUMANCTL_FORBIDDEN_SOURCE_NAMES  comma or newline separated extra names`);
}

function parseArgs(argv) {
  const args = { root: null, names: [], selftest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      if (!argv[i + 1]) throw new Error("--root needs a path");
      args.root = argv[++i];
    } else if (arg === "--forbid") {
      if (!argv[i + 1]) throw new Error("--forbid needs a name");
      args.names.push(argv[++i]);
    } else if (arg === "--selftest") {
      args.selftest = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function defaultRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function prohibitedNames(extra = []) {
  const envNames = (process.env.HUMANCTL_FORBIDDEN_SOURCE_NAMES || "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const decodedDefault = Buffer.from(DEFAULT_NAME_BASE64, "base64").toString("utf8");
  return [...new Set([decodedDefault, ...envNames, ...extra].map((value) => value.trim()).filter(Boolean))];
}

function repositoryFiles(root) {
  const output = execFileSync(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function isTextSurface(relativePath) {
  const base = path.basename(relativePath);
  if (TEXT_BASENAMES.has(base) || /^README(?:\.|$)/i.test(base) || /^LICENSE(?:\.|$)/i.test(base) || /^NOTICE(?:\.|$)/i.test(base)) {
    return true;
  }
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase());
}

function lineFor(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

export function scanEntries(entries, names) {
  const normalizedNames = names.map((name) => name.toLocaleLowerCase("en-US"));
  const findings = [];

  for (const entry of entries) {
    const loweredPath = entry.path.toLocaleLowerCase("en-US");
    normalizedNames.forEach((name, nameIndex) => {
      if (loweredPath.includes(name)) {
        findings.push({ path: entry.path, line: null, nameIndex, location: "path" });
      }
    });

    if (entry.text == null) continue;
    const loweredText = entry.text.toLocaleLowerCase("en-US");
    normalizedNames.forEach((name, nameIndex) => {
      let from = 0;
      while (from <= loweredText.length) {
        const index = loweredText.indexOf(name, from);
        if (index < 0) break;
        findings.push({
          path: entry.path,
          line: lineFor(entry.text, index),
          nameIndex,
          location: "content",
        });
        from = index + Math.max(1, name.length);
      }
    });
  }

  return findings;
}

function entriesFromRepository(root) {
  return repositoryFiles(root).filter((relativePath) => existsSync(path.join(root, relativePath))).map((relativePath) => {
    if (!isTextSurface(relativePath)) return { path: relativePath, text: null };
    const buffer = readFileSync(path.join(root, relativePath));
    if (buffer.includes(0)) return { path: relativePath, text: null };
    return { path: relativePath, text: buffer.toString("utf8") };
  });
}

function runSelftest() {
  const [name] = prohibitedNames();
  const clean = scanEntries(
    [{ path: "docs/foundation.md", text: "Humanctl owns this neutral Registry foundation." }],
    [name],
  );
  if (clean.length !== 0) throw new Error("clean fixture produced a finding");

  const contentHit = scanEntries(
    [{ path: "docs/foundation.md", text: `prefix ${name.toUpperCase()} suffix` }],
    [name],
  );
  if (contentHit.length !== 1 || contentHit[0].location !== "content") {
    throw new Error("case-insensitive content fixture was not detected");
  }

  const pathHit = scanEntries(
    [{ path: `docs/${name.toUpperCase()}-notes.md`, text: "neutral text" }],
    [name],
  );
  if (pathHit.length !== 1 || pathHit[0].location !== "path") {
    throw new Error("case-insensitive path fixture was not detected");
  }

  console.log("[ui-foundation:hygiene] selftest passed");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    runSelftest();
    return;
  }

  const root = path.resolve(args.root || defaultRoot());
  const names = prohibitedNames(args.names);
  const entries = entriesFromRepository(root);
  const findings = scanEntries(entries, names);

  if (findings.length > 0) {
    console.error(`[ui-foundation:hygiene] failed with ${findings.length} finding${findings.length === 1 ? "" : "s"}`);
    for (const finding of findings) {
      const where = finding.line == null ? finding.path : `${finding.path}:${finding.line}`;
      console.error(`  ${where}: prohibited source name #${finding.nameIndex + 1} in ${finding.location}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[ui-foundation:hygiene] passed (${entries.length} repository paths checked)`);
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  try {
    main();
  } catch (error) {
    console.error(`[ui-foundation:hygiene] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
