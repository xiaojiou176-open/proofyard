#!/usr/bin/env node

import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const outputPath = resolve(process.argv[2] ?? "dist/server.cjs")
const shebang = "#!/usr/bin/env node\n"
const source = readFileSync(outputPath, "utf8").replace(/^#!\/usr\/bin\/env node\r?\n/, "")

writeFileSync(outputPath, `${shebang}${source}`, "utf8")
chmodSync(outputPath, 0o755)

console.log(`[mcp-build] finalized ${outputPath} with shebang at line 1`)
