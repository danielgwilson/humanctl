import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
const registry = JSON.parse(readFileSync(resolve(root, "registry.json"), "utf8"))

const failures = []
const itemNames = new Set()
const registryFiles = new Map()

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(css|ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

for (const [name, target] of Object.entries(packageJson.exports)) {
  if (name.includes("*")) failures.push(`Wildcard export is not allowed: ${name}`)
  if (!existsSync(resolve(root, target))) failures.push(`Missing export target: ${name} -> ${target}`)
}

for (const item of registry.items) {
  if (itemNames.has(item.name)) failures.push(`Duplicate Registry item name: ${item.name}`)
  itemNames.add(item.name)
  if ((item.registryDependencies ?? []).length > 0) failures.push(`${item.name} declares install dependencies; this Registry is local organization only`)
  for (const file of item.files ?? []) {
    if (!existsSync(resolve(root, file.path))) failures.push(`${item.name} has missing file ${file.path}`)
    const priorOwner = registryFiles.get(file.path)
    if (priorOwner) failures.push(`${file.path} is owned by both ${priorOwner} and ${item.name}`)
    else registryFiles.set(file.path, item.name)
  }
}

for (const [name, target] of Object.entries(packageJson.exports)) {
  const normalized = target.replace(/^\.\//, "")
  if (/^src\/(components|blocks|styles|hooks|lib|catalog)\//.test(normalized) && !registryFiles.has(normalized)) {
    failures.push(`Registry does not organize exported leaf ${name} -> ${normalized}`)
  }
}

const publicRegistry = resolve(root, "public/r")
if (existsSync(publicRegistry) && readdirSync(publicRegistry).some((file) => file.endsWith(".json"))) {
  failures.push("Built Registry payloads must not be retained or published under public/r")
}

if (existsSync(resolve(root, "src/components/card.tsx")) || packageJson.exports["./components/card"]) {
  failures.push("Card primitives are outside the foundation contract")
}

const globals = readFileSync(resolve(root, "src/styles/globals.css"), "utf8")
const tokens = readFileSync(resolve(root, "src/styles/tokens.css"), "utf8")
if (/font-sans\s+font-mono|font-mono\s+font-sans/.test(globals)) failures.push("The document root cannot apply both sans and mono fonts")
if (!globals.includes('@import "@fontsource-variable/geist"')) failures.push("Geist Variable must be loaded by the foundation")
if (/Space Grotesk|JetBrains Mono|Geist Mono/.test(`${globals}\n${tokens}`)) failures.push("Legacy or global mono font family remains in the foundation")
if (!existsSync(resolve(root, "src/styles/typeset.css"))) failures.push("The shadcn Typeset foundation is missing")
if (!packageJson.exports["./components/sidebar"]) failures.push("The official Sidebar foundation is not exported")

const sources = sourceFiles(resolve(root, "src"))
const declaredProperties = new Set()
const referencedProperties = new Set()
const runtimeProperties = new Set([
  "--anchor-width",
  "--available-height",
  "--sidebar-width",
  "--sidebar-width-icon",
  "--transform-origin",
])

for (const file of sources) {
  const source = readFileSync(file, "utf8")
  for (const match of source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) declaredProperties.add(match[1])
  for (const match of source.matchAll(/var\((--[a-z0-9-]+)/g)) referencedProperties.add(match[1])
}

for (const property of referencedProperties) {
  if (!declaredProperties.has(property) && !runtimeProperties.has(property)) {
    failures.push(`Undefined custom property: ${property}`)
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exitCode = 1
} else {
  console.log(`Verified ${Object.keys(packageJson.exports).length} explicit exports across ${registry.items.length} registry items.`)
}
