import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Docs-coverage gate for the component catalog. Proves the catalog viewer and
// the package's public component/block leaves agree in both directions, so a
// new primitive cannot ship undocumented and a renamed export cannot leave a
// dead catalog page. Zero dependencies: it reads the catalog entry sources as
// text rather than importing React, so it runs under plain node in CI.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
const entriesDir = resolve(root, "src/catalog/entries")

// Required coverage: every ./components/* and ./blocks/* leaf export.
const requiredLeaves = new Set()
for (const name of Object.keys(packageJson.exports)) {
  const leaf = name.replace(/^\.\//, "")
  if (/^(components|blocks)\//.test(leaf)) requiredLeaves.add(leaf)
}

const failures = []
const documentedLeaves = new Set()
const seenImportPaths = new Set()

let entryCount = 0
let usageCount = 0
let statesCount = 0

for (const file of readdirSync(entriesDir)) {
  if (!file.endsWith(".tsx")) continue
  const source = readFileSync(resolve(entriesDir, file), "utf8")

  const ids = [...source.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1])
  entryCount += ids.length
  usageCount += (source.match(/\busage:\s*`/g) ?? []).length
  statesCount += (source.match(/\bstates:\s*\[/g) ?? []).length

  for (const match of source.matchAll(/\bimportPath:\s*"([^"]+)"/g)) {
    const importPath = match[1]
    if (seenImportPaths.has(importPath)) {
      failures.push(`Duplicate catalog importPath: ${importPath} (in ${file})`)
    }
    seenImportPaths.add(importPath)

    if (/^(components|blocks)\//.test(importPath)) {
      documentedLeaves.add(importPath)
      const exportName = `./${importPath}`
      if (!packageJson.exports[exportName]) {
        failures.push(`${file} documents ${exportName}, which is not a package export`)
      }
    } else if (!importPath.startsWith("styles/")) {
      failures.push(`${file} has an unrecognized importPath: ${importPath}`)
    }
  }
}

for (const leaf of requiredLeaves) {
  if (!documentedLeaves.has(leaf)) {
    failures.push(`Undocumented public leaf: ./${leaf} has no catalog entry`)
  }
}

// Every entry carries a live-preview states array and a usage snippet. Counts
// are compared against the id count, so a missing block on any entry fails.
if (usageCount < entryCount) failures.push(`${entryCount - usageCount} catalog entr(y/ies) missing a usage snippet`)
if (statesCount < entryCount) failures.push(`${entryCount - statesCount} catalog entr(y/ies) missing a states array`)

// The catalog must mount the new viewer, not the retired kitchen sink.
if (existsSync(resolve(root, "src/catalog/foundation-catalog.tsx"))) {
  failures.push("The retired foundation-catalog.tsx must be removed")
}
if (packageJson.exports["./catalog"] !== "./src/catalog/catalog-app.tsx") {
  failures.push('The ./catalog export must point at src/catalog/catalog-app.tsx')
}

if (failures.length > 0) {
  console.error("[verify-catalog] FAIL:")
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `[verify-catalog] ${entryCount} entries cover ${requiredLeaves.size} public component and block leaves; usage and previews present on every entry.`,
  )
}
