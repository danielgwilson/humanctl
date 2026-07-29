#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const DEFAULT_UI_ROOT = "packages/ui";
const DEFAULT_RENDERER_ROOT = "electron/renderer-vite/src";

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "dist-electron-vite",
  "node_modules",
  "screenshots",
]);

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const VISUAL_DEPENDENCIES = [
  "@base-ui/",
  "@fontsource/",
  "@fontsource-variable/",
  "@radix-ui/",
  "@xyflow/react",
  "class-variance-authority",
  "clsx",
  "cmdk",
  "framer-motion",
  "lucide-react",
  "motion",
  "radix-ui",
  "recharts",
  "shadcn",
  "sonner",
  "tailwind-merge",
  "tailwindcss",
  "tw-animate-css",
  "vaul",
];

function usage() {
  console.log(`Usage: node scripts/ui-foundation-ownership.mjs [options]

Options:
  --root <path>           repository root (defaults to process.cwd())
  --ui-root <path>        Registry owner relative to root (default: ${DEFAULT_UI_ROOT})
  --renderer-root <path>  renderer source relative to root (default: ${DEFAULT_RENDERER_ROOT})
  --json                  print machine-readable findings
  --selftest              run positive and negative fixture cases
  --help                  show this help`);
}

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    uiRoot: DEFAULT_UI_ROOT,
    rendererRoot: DEFAULT_RENDERER_ROOT,
    json: false,
    selftest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      if (!argv[i + 1]) throw new Error("--root needs a path");
      args.root = argv[++i];
    } else if (arg === "--ui-root") {
      if (!argv[i + 1]) throw new Error("--ui-root needs a path");
      args.uiRoot = argv[++i];
    } else if (arg === "--renderer-root") {
      if (!argv[i + 1]) throw new Error("--renderer-root needs a path");
      args.rendererRoot = argv[++i];
    } else if (arg === "--json") {
      args.json = true;
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

function normalize(value) {
  return value.split(path.sep).join("/");
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else files.push(target);
    }
  };
  walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function parseJson(file, add, kind) {
  if (!existsSync(file)) {
    add(file, null, kind, "required file is missing");
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    add(file, null, kind, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function sourceFile(file, text) {
  const extension = path.extname(file);
  const kind = extension === ".tsx" || extension === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function importRecords(source) {
  const records = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      records.push({
        specifier: statement.moduleSpecifier.text,
        typeOnly: Boolean(statement.importClause?.isTypeOnly),
        node: statement,
      });
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      records.push({
        specifier: statement.moduleSpecifier.text,
        typeOnly: Boolean(statement.isTypeOnly),
        node: statement,
      });
    }
  }
  return records;
}

function isVisualDependency(specifier) {
  return VISUAL_DEPENDENCIES.some((name) => (
    name.endsWith("/") ? specifier.startsWith(name) : specifier === name || specifier.startsWith(`${name}/`)
  ));
}

function exportTarget(exportsMap, subpath) {
  const value = exportsMap?.[subpath];
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    for (const key of ["import", "default", "types"]) {
      if (typeof value[key] === "string") return value[key];
    }
  }
  return null;
}

function inspectRegistryPackage(context) {
  const { uiRoot, add } = context;
  const requiredDirectories = ["src/components", "src/blocks", "src/styles"];
  for (const directory of requiredDirectories) {
    const target = path.join(uiRoot, directory);
    if (!existsSync(target)) add(target, null, "registry-layout", "required Registry owner directory is missing");
  }

  const manifest = parseJson(path.join(uiRoot, "package.json"), add, "registry-package");
  const packageName = typeof manifest?.name === "string" ? manifest.name : "@humanctl/ui";
  if (manifest) {
    if (manifest.private !== true) add(path.join(uiRoot, "package.json"), null, "registry-package", "UI owner package must be private");
    if (!packageName.startsWith("@humanctl/")) {
      add(path.join(uiRoot, "package.json"), null, "registry-package", "UI owner package name must use the @humanctl scope");
    }
  }

  const config = parseJson(path.join(uiRoot, "components.json"), add, "registry-config");
  if (config) {
    const expected = [
      ["style", config.style, "base-nova"],
      ["rsc", config.rsc, false],
      ["tsx", config.tsx, true],
      ["iconLibrary", config.iconLibrary, "lucide"],
      ["tailwind.baseColor", config.tailwind?.baseColor, "neutral"],
      ["tailwind.cssVariables", config.tailwind?.cssVariables, true],
      ["tailwind.css", config.tailwind?.css, "src/styles/globals.css"],
      ["aliases.components", config.aliases?.components, `${packageName}/components`],
      ["aliases.ui", config.aliases?.ui, `${packageName}/components`],
      ["aliases.lib", config.aliases?.lib, `${packageName}/lib`],
      ["aliases.hooks", config.aliases?.hooks, `${packageName}/hooks`],
    ];
    for (const [field, actual, wanted] of expected) {
      if (actual !== wanted) {
        add(path.join(uiRoot, "components.json"), null, "registry-config", `${field} must be ${JSON.stringify(wanted)}, received ${JSON.stringify(actual)}`);
      }
    }
    const allowedUtilsAliases = new Set([`${packageName}/lib/utils`, `${packageName}/lib/cn`]);
    if (!allowedUtilsAliases.has(config.aliases?.utils)) {
      add(
        path.join(uiRoot, "components.json"),
        null,
        "registry-config",
        `aliases.utils must be a package-owned utility leaf, received ${JSON.stringify(config.aliases?.utils)}`,
      );
    }
  }

  if (manifest) {
    const sources = [
      ...walkFiles(path.join(uiRoot, "src/components")),
      ...walkFiles(path.join(uiRoot, "src/blocks")),
    ].filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)));
    for (const file of sources) {
      const ownerKind = inside(path.join(uiRoot, "src/components"), file) ? "components" : "blocks";
      const relativeLeaf = normalize(path.relative(path.join(uiRoot, `src/${ownerKind}`), file)).replace(/\.(?:jsx?|tsx?)$/, "");
      const subpath = `./${ownerKind}/${relativeLeaf}`;
      const target = exportTarget(manifest.exports, subpath);
      if (!target) {
        add(path.join(uiRoot, "package.json"), null, "registry-export", `${subpath} needs an explicit package export`);
      }
    }
    if (!exportTarget(manifest.exports, "./styles/globals.css")) {
      add(path.join(uiRoot, "package.json"), null, "registry-export", "./styles/globals.css needs an explicit package export");
    }
    for (const [subpath, value] of Object.entries(manifest.exports || {})) {
      if (!subpath.startsWith("./components/") && !subpath.startsWith("./blocks/")) continue;
      const target = typeof value === "string" ? value : exportTarget(manifest.exports, subpath);
      if (target && !target.includes("*") && !existsSync(path.resolve(uiRoot, target))) {
        add(path.join(uiRoot, "package.json"), null, "registry-export", `${subpath} points to missing source ${target}`);
      }
    }
  }

  return packageName;
}

function inspectSource(context, file, area, packageName) {
  const { rendererRoot, runtimeRoot, viewportRoot, add } = context;
  const text = readFileSync(file, "utf8");
  const source = sourceFile(file, text);

  for (const record of importRecords(source)) {
    const specifier = record.specifier;
    const at = lineOf(source, record.node);
    if (area !== "ui" && isVisualDependency(specifier)) {
      add(file, at, "direct-visual-dependency", `${specifier} is package-owned and cannot be imported from ${area}`);
    }
    if (area !== "ui" && /^@\/(?:components|ui|blocks|styles|lib|hooks)(?:\/|$)/.test(specifier)) {
      add(file, at, "app-local-visual-import", `${specifier} recreates an app-local visual tree`);
    }

    if (area === "runtime") {
      if ((specifier === packageName || specifier.startsWith(`${packageName}/`)) && !record.typeOnly) {
        add(file, at, "runtime-visual-import", "runtime may import the UI package only with import type");
      }
      if (specifier === "electron" || specifier.startsWith("node:")) {
        add(file, at, "runtime-privilege", `${specifier} is not available to the sandboxed renderer runtime`);
      }
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        if (!inside(runtimeRoot, target)) add(file, at, "runtime-import", "runtime relative imports must stay inside runtime");
      } else if (
        specifier !== "react" &&
        specifier !== "react/jsx-runtime" &&
        specifier !== packageName &&
        !specifier.startsWith(`${packageName}/`)
      ) {
        add(file, at, "runtime-import", `${specifier} is not part of the runtime adapter interface`);
      }
    }

    if (area === "viewport" || area === "main") {
      let allowed = specifier === "react" || specifier === "react/jsx-runtime" || specifier === "react-dom/client";
      allowed ||= specifier === packageName || specifier.startsWith(`${packageName}/`);
      allowed ||= specifier.startsWith("@/runtime") || specifier.startsWith("@/viewport");
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        allowed ||= inside(runtimeRoot, target) || inside(viewportRoot, target);
      }
      if (!allowed) add(file, at, "viewport-import", `${specifier} is outside the viewport interface`);
    }

    if (area === "ui" && specifier.startsWith(".")) {
      const target = path.resolve(path.dirname(file), specifier);
      if (inside(rendererRoot, target) || normalize(target).includes("/electron/renderer-vite/")) {
        add(file, at, "reverse-dependency", "the UI package cannot import the renderer or runtime adapter");
      }
    }
  }

  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "window" &&
      node.name.text === "humanctl" &&
      area !== "runtime"
    ) {
      add(file, lineOf(source, node), "bridge-ownership", "window.humanctl is owned only by runtime");
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if ((area === "viewport" || area === "main") && /^[a-z]/.test(tag)) {
        add(file, lineOf(source, node), "intrinsic-dom", `${tag} belongs in a package-owned block`);
      }
      if (area === "runtime") {
        add(file, lineOf(source, node), "runtime-dom", "runtime renders no JSX or DOM");
      }
      if (area === "viewport" || area === "main") {
        for (const property of node.attributes.properties) {
          if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) continue;
          if (property.name.text === "className" || property.name.text === "style") {
            add(file, lineOf(source, property), "viewport-style", `${property.name.text} belongs in packages/ui`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

export function auditFoundation(options) {
  const root = path.resolve(options.root);
  const uiRoot = path.resolve(root, options.uiRoot || DEFAULT_UI_ROOT);
  const rendererRoot = path.resolve(root, options.rendererRoot || DEFAULT_RENDERER_ROOT);
  const runtimeRoot = path.join(rendererRoot, "runtime");
  const viewportRoot = path.join(rendererRoot, "viewport");
  const findings = [];
  const relative = (file) => normalize(path.relative(root, file));
  const add = (file, line, kind, message) => findings.push({ file: relative(file), line, kind, message });
  const context = { root, uiRoot, rendererRoot, runtimeRoot, viewportRoot, add };

  const packageName = inspectRegistryPackage(context);

  for (const directory of [rendererRoot, runtimeRoot, viewportRoot]) {
    if (!existsSync(directory)) add(directory, null, "renderer-layout", "required renderer directory is missing");
  }
  for (const file of [path.join(rendererRoot, "main.tsx"), path.join(rendererRoot, "index.html")]) {
    if (!existsSync(file)) add(file, null, "renderer-layout", "required renderer bootstrap file is missing");
  }

  for (const file of walkFiles(uiRoot)) {
    if (SOURCE_EXTENSIONS.has(path.extname(file))) inspectSource(context, file, "ui", packageName);
  }

  const allowedRootFiles = new Set(["env.d.ts", "index.html", "main.tsx", "vite-env.d.ts"]);
  for (const file of walkFiles(rendererRoot)) {
    const rel = normalize(path.relative(rendererRoot, file));
    let area = null;
    if (inside(runtimeRoot, file)) area = "runtime";
    else if (inside(viewportRoot, file)) area = "viewport";
    else if (rel === "main.tsx") area = "main";
    else if (!allowedRootFiles.has(rel)) {
      add(file, null, "renderer-debt", "renderer source must live in runtime, viewport, main.tsx, or index.html");
      continue;
    }

    if (path.extname(file) === ".css") {
      add(file, null, "renderer-css", "renderer CSS is forbidden; import the package stylesheet from main.tsx");
    }
    if (area && SOURCE_EXTENSIONS.has(path.extname(file))) inspectSource(context, file, area, packageName);
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || (a.line || 0) - (b.line || 0) || a.kind.localeCompare(b.kind));
  return findings;
}

function writeFixture(root) {
  const write = (relative, contents) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };

  write("packages/ui/package.json", JSON.stringify({
    name: "@humanctl/ui",
    private: true,
    exports: {
      "./components/button": "./src/components/button.tsx",
      "./blocks/humanctl-viewport": "./src/blocks/humanctl-viewport.tsx",
      "./styles/globals.css": "./src/styles/globals.css",
    },
  }, null, 2));
  write("packages/ui/components.json", JSON.stringify({
    $schema: "https://ui.shadcn.com/schema.json",
    style: "base-nova",
    rsc: false,
    tsx: true,
    tailwind: { config: "", css: "src/styles/globals.css", baseColor: "neutral", cssVariables: true, prefix: "" },
    iconLibrary: "lucide",
    aliases: {
      components: "@humanctl/ui/components",
      ui: "@humanctl/ui/components",
      lib: "@humanctl/ui/lib",
      utils: "@humanctl/ui/lib/utils",
      hooks: "@humanctl/ui/hooks",
    },
  }, null, 2));
  write("packages/ui/src/components/button.tsx", "export function Button() { return <button type=\"button\" />; }\n");
  write("packages/ui/src/blocks/humanctl-viewport.tsx", "export type HumanctlViewportModel = { ready: boolean };\nexport function HumanctlViewport(_props: { model: HumanctlViewportModel; dispatch: (intent: string) => void }) { return <main />; }\n");
  write("packages/ui/src/styles/globals.css", ":root { color-scheme: light dark; }\n");
  write("electron/renderer-vite/src/runtime/index.ts", "import type { HumanctlViewportModel } from \"@humanctl/ui/blocks/humanctl-viewport\";\nexport function useHumanctlRuntime(): { model: HumanctlViewportModel; dispatch: (intent: string) => void } { return { model: { ready: true }, dispatch: () => {} }; }\n");
  write("electron/renderer-vite/src/viewport/index.tsx", "import { HumanctlViewport } from \"@humanctl/ui/blocks/humanctl-viewport\";\nimport { useHumanctlRuntime } from \"../runtime/index\";\nexport function Viewport() { const runtime = useHumanctlRuntime(); return <HumanctlViewport {...runtime} />; }\n");
  write("electron/renderer-vite/src/main.tsx", "import React from \"react\";\nimport { createRoot } from \"react-dom/client\";\nimport \"@humanctl/ui/styles/globals.css\";\nimport { Viewport } from \"./viewport/index\";\ncreateRoot(document.getElementById(\"root\")).render(<React.StrictMode><Viewport /></React.StrictMode>);\n");
  write("electron/renderer-vite/src/index.html", "<div id=\"root\"></div>\n");
}

function runSelftest() {
  const root = mkdtempSync(path.join(os.tmpdir(), "humanctl-ui-owner-"));
  try {
    writeFixture(root);
    const clean = auditFoundation({ root, uiRoot: DEFAULT_UI_ROOT, rendererRoot: DEFAULT_RENDERER_ROOT });
    if (clean.length > 0) throw new Error(`clean fixture produced findings: ${JSON.stringify(clean)}`);

    const badFile = path.join(root, DEFAULT_RENDERER_ROOT, "viewport", "bad.tsx");
    writeFileSync(badFile, "import { Circle } from \"lucide-react\";\nexport function Bad() { window.humanctl; return <button className=\"p-4\"><Circle /></button>; }\n");
    const bad = auditFoundation({ root, uiRoot: DEFAULT_UI_ROOT, rendererRoot: DEFAULT_RENDERER_ROOT });
    const kinds = new Set(bad.map((finding) => finding.kind));
    for (const expected of ["direct-visual-dependency", "bridge-ownership", "intrinsic-dom", "viewport-style"]) {
      if (!kinds.has(expected)) throw new Error(`negative fixture did not produce ${expected}`);
    }
    console.log("[ui-foundation:ownership] selftest passed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    runSelftest();
    return;
  }

  const findings = auditFoundation(args);
  if (args.json) {
    console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
  } else if (findings.length > 0) {
    console.error(`[ui-foundation:ownership] failed with ${findings.length} finding${findings.length === 1 ? "" : "s"}`);
    for (const finding of findings) {
      const where = finding.line == null ? finding.file : `${finding.file}:${finding.line}`;
      console.error(`  ${where} [${finding.kind}] ${finding.message}`);
    }
  } else {
    console.log("[ui-foundation:ownership] passed");
  }
  if (findings.length > 0) process.exitCode = 1;
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  try {
    main();
  } catch (error) {
    console.error(`[ui-foundation:ownership] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
