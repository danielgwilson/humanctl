import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
const registry = JSON.parse(readFileSync(resolve(root, "registry.json"), "utf8"))

const failures = []

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

const registryNames = new Set(registry.items.map((item) => item.name))

for (const item of registry.items) {
  for (const dependency of item.registryDependencies ?? []) {
    if (!registryNames.has(dependency)) failures.push(`${item.name} has unknown registry dependency ${dependency}`)
  }
  for (const file of item.files ?? []) {
    if (!existsSync(resolve(root, file.path))) failures.push(`${item.name} has missing file ${file.path}`)
  }
}

if (existsSync(resolve(root, "src/components/card.tsx")) || packageJson.exports["./components/card"]) {
  failures.push("Card primitives are outside the foundation contract")
}

const sources = sourceFiles(resolve(root, "src"))
const declaredProperties = new Set()
const referencedProperties = new Set()
const runtimeProperties = new Set(["--anchor-width", "--available-height", "--transform-origin"])

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
