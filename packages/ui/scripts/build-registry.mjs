import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = resolve(root, "public/r")
const shadcn = resolve(root, "node_modules/.bin/shadcn")

const importRewrites = [
  ["@humanctl/ui/lib/cn", "@/lib/cn"],
  ["@humanctl/ui/components/", "@/components/ui/"],
  ["@humanctl/ui/hooks/", "@/hooks/"],
  ["@humanctl/ui/blocks/", "@/blocks/"],
  ["@humanctl/ui/styles/", "@/styles/"],
  ["@humanctl/ui/catalog/", "@/catalog/"],
]

execFileSync(shadcn, ["build"], { cwd: root, stdio: "inherit" })

let rewrittenItems = 0
for (const filename of readdirSync(outDir)) {
  if (!filename.endsWith(".json") || filename === "registry.json") continue
  const path = resolve(outDir, filename)
  const item = JSON.parse(readFileSync(path, "utf8"))
  let changed = false
  for (const file of item.files ?? []) {
    if (typeof file.content !== "string") continue
    let content = file.content
    for (const [from, to] of importRewrites) content = content.replaceAll(from, to)
    if (content !== file.content) {
      file.content = content
      changed = true
    }
  }
  if (changed) {
    writeFileSync(path, `${JSON.stringify(item, null, 2)}\n`)
    rewrittenItems += 1
  }
}

console.log(`Rewrote package-local imports in ${rewrittenItems} Registry items.`)
