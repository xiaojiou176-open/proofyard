#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { extname, resolve } from "node:path"
import ts from "typescript"

const ROOT = process.cwd()
const FRONTEND_SRC = resolve(ROOT, "apps/web/src")
const MANIFEST_FILE = resolve(ROOT, "apps/web/src/testing/button-manifest.ts")
const TEST_IDS_FILE = resolve(ROOT, "apps/web/src/constants/testIds.ts")

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"])
const INTERACTIVE_TAGS = new Set(["button", "input", "select", "textarea"])
const INTERACTIVE_COMPONENTS = new Set([
  "Button",
  "Input",
  "Textarea",
  "TabsTrigger",
  "Checkbox",
  "Switch",
  "Select",
  "SelectTrigger",
  "DialogTrigger",
])
const TEST_FILE_MARKERS = [".test.", ".spec."]
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".runtime-cache",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  ".next",
  ".turbo",
  "testing",
  "__tests__",
  "tests",
])

function collectFiles(inputPath) {
  if (!existsSync(inputPath)) return []
  const info = statSync(inputPath)
  if (info.isFile()) return [inputPath]
  if (!info.isDirectory()) return []

  const files = []
  const stack = [inputPath]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const nextPath = resolve(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue
        stack.push(nextPath)
        continue
      }
      if (
        entry.isFile() &&
        CODE_EXTENSIONS.has(extname(entry.name).toLowerCase()) &&
        !TEST_FILE_MARKERS.some((marker) => entry.name.includes(marker))
      ) {
        files.push(nextPath)
      }
    }
  }
  return files
}

function lineAt(source, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1
  }
  return line
}

function parseManifestEntries(source) {
  const blockMatch = source.match(
    /export const\s+BUTTON_BEHAVIOR_MANIFEST\s*=\s*\[([\s\S]*?)\]\s*as const/
  )
  if (!blockMatch) throw new Error("BUTTON_BEHAVIOR_MANIFEST not found.")

  const entries = []
  const objectPattern = /\{([\s\S]*?)\}/g
  let objectMatch = objectPattern.exec(blockMatch[1])
  while (objectMatch) {
    const objectText = objectMatch[1]
    const idMatch = objectText.match(/id\s*:\s*(['"])(.*?)\1/)
    const selectorMatch = objectText.match(/selector\s*:\s*(['"])(.*?)\1/)
    if (idMatch && selectorMatch) {
      entries.push({
        id: idMatch[2].trim(),
        selector: selectorMatch[2].trim(),
      })
    }
    objectMatch = objectPattern.exec(blockMatch[1])
  }

  if (entries.length === 0) throw new Error("No manifest entries parsed.")
  return entries
}

function toSelectorRecord(selector, file, line, kind) {
  return { selector, file, line, kind }
}

function readTestIdConstantMap() {
  if (!existsSync(TEST_IDS_FILE)) return new Map()
  const source = readFileSync(TEST_IDS_FILE, "utf8")
  const map = new Map()
  const pattern = /export const\s+([A-Z0-9_]+)\s*=\s*["']([^"']+)["']/g
  let match = pattern.exec(source)
  while (match) {
    map.set(match[1], match[2])
    match = pattern.exec(source)
  }
  return map
}

function collectInventoryFromSource(file, source, invalidIgnores, sharedConstMap) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const records = []
  const importedConstMap = new Map(sharedConstMap)

  const readExpressionString = (expression) => {
    if (!expression) return ""
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text.trim()
    }
    if (ts.isIdentifier(expression)) {
      return importedConstMap.get(expression.text) ?? ""
    }
    return ""
  }

  const readAttributeValue = (attribute) => {
    if (!attribute?.initializer) return ""
    if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text.trim()
    if (ts.isJsxExpression(attribute.initializer)) {
      return readExpressionString(attribute.initializer.expression)
    }
    return ""
  }

  const collectElementText = (node) => {
    if (!node || !("children" in node)) return ""
    const chunks = []
    for (const child of node.children) {
      if (ts.isJsxText(child)) {
        const text = child.getText(sourceFile).replace(/\s+/g, " ").trim()
        if (text) chunks.push(text)
        continue
      }
      if (ts.isJsxExpression(child)) {
        const value = readExpressionString(child.expression)
        if (!value) return ""
        chunks.push(value)
        continue
      }
      if (ts.isJsxElement(child) || ts.isJsxFragment(child)) {
        const nested = collectElementText(child)
        if (!nested) return ""
        chunks.push(nested)
      }
    }
    return chunks.join(" ").replace(/\s+/g, " ").trim()
  }

  const getTagName = (node) => {
    if (ts.isJsxElement(node)) return node.openingElement.tagName.getText(sourceFile)
    if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(sourceFile)
    return ""
  }

  const collectAttrs = (attributesNode) => {
    const attrs = new Map()
    for (const property of attributesNode.properties) {
      if (!ts.isJsxAttribute(property)) continue
      attrs.set(property.name.text, readAttributeValue(property))
    }
    return attrs
  }

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.moduleSpecifier.text.includes("constants/testIds")) {
        const bindings = node.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text
            const localName = element.name.text
            const resolved = sharedConstMap.get(importedName)
            if (resolved) importedConstMap.set(localName, resolved)
          }
        }
      }
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const value = readExpressionString(declaration.initializer)
        if (value) importedConstMap.set(declaration.name.text, value)
      }
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = getTagName(node)
      const attributesNode = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes
      const attrs = collectAttrs(attributesNode)
      const line = lineAt(source, node.getStart(sourceFile))
      const ignoreReason = attrs.get("data-uiq-ignore-button-inventory") ?? ""
      if (attrs.has("data-uiq-ignore-button-inventory") && !ignoreReason) {
        invalidIgnores.push(`${file}:${line} data-uiq-ignore-button-inventory 缺少非空 reason`)
      }

      if (!ignoreReason) {
        const explicitRole = attrs.get("role") ?? ""
        const interactiveLike =
          INTERACTIVE_TAGS.has(tagName) ||
          INTERACTIVE_COMPONENTS.has(tagName) ||
          explicitRole === "button" ||
          explicitRole === "tab"

        if (interactiveLike) {
          const testId = attrs.get("data-testid") ?? ""
          const ariaLabel = attrs.get("aria-label") ?? ""
          if (testId) {
            records.push(toSelectorRecord(`data-testid=${testId}`, file, line, `${tagName}.data-testid`))
          }
          if (ariaLabel) {
            records.push(toSelectorRecord(`aria-label=${ariaLabel}`, file, line, `${tagName}.aria-label`))
          }

          const supportsTextRoleSelector =
            tagName === "button" || tagName === "Button" || tagName === "TabsTrigger" || tagName === "DialogTrigger"
          const inferredRole = explicitRole || (tagName === "TabsTrigger" ? "tab" : "button")
          const text = ts.isJsxElement(node) ? collectElementText(node) : ""
          if (supportsTextRoleSelector && text && !testId && !ariaLabel && inferredRole === "button") {
            records.push(toSelectorRecord(`role=button[name="${text}"]`, file, line, `${tagName}.text`))
          }
          if (supportsTextRoleSelector && text && !testId && !ariaLabel && inferredRole === "tab") {
            records.push(toSelectorRecord(`role=tab[name="${text}"]`, file, line, `${tagName}.text`))
            records.push(
              toSelectorRecord(`role=tab[name^="${text}"]`, file, line, `${tagName}.text-prefix`)
            )
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return records
}

function selectorMatchesManifest(manifestSelector, inventorySelector) {
  if (manifestSelector === inventorySelector) return true
  if (
    manifestSelector.startsWith("role=") &&
    manifestSelector.includes('[name^="') &&
    manifestSelector.endsWith('"]')
  ) {
    const roleEnd = manifestSelector.indexOf('[name^="')
    const role = manifestSelector.slice("role=".length, roleEnd)
    const prefix = manifestSelector.slice(roleEnd + 8, -2)
    const exact = `role=${role}[name="${prefix}"]`
    if (inventorySelector === exact) return true
    const inventoryPrefix = `role=${role}[name="`
    if (inventorySelector.startsWith(inventoryPrefix) && inventorySelector.endsWith('"]')) {
      const name = inventorySelector.slice(inventoryPrefix.length, -2)
      return name.startsWith(prefix)
    }
  }
  return false
}

function main() {
  if (!existsSync(MANIFEST_FILE)) {
    console.error(`[check-button-inventory] missing manifest file: ${MANIFEST_FILE}`)
    process.exit(2)
  }
  if (!existsSync(FRONTEND_SRC)) {
    console.error(`[check-button-inventory] missing source root: ${FRONTEND_SRC}`)
    process.exit(2)
  }

  const manifestEntries = parseManifestEntries(readFileSync(MANIFEST_FILE, "utf8"))
  const sourceFiles = collectFiles(FRONTEND_SRC)
  const invalidIgnores = []
  const constMap = readTestIdConstantMap()
  const inventoryRecords = sourceFiles.flatMap((file) =>
    collectInventoryFromSource(file, readFileSync(file, "utf8"), invalidIgnores, constMap)
  )
  if (invalidIgnores.length > 0) {
    console.error(`[check-button-inventory] invalid ignore reasons: ${invalidIgnores.length}`)
    for (const error of invalidIgnores) console.error(`- ${error}`)
    process.exit(1)
  }

  const inventorySelectors = [...new Set(inventoryRecords.map((item) => item.selector))]
  const fallbackPresence = (entry) => {
    if (entry.selector.startsWith("data-testid=")) {
      const value = entry.selector.slice("data-testid=".length)
      return sourceFiles.some((file) => {
        const source = readFileSync(file, "utf8")
        if (source.includes(`"${value}"`) || source.includes(`'${value}'`)) return true
        for (const [constName, constValue] of constMap.entries()) {
          if (constValue === value && source.includes(constName)) return true
        }
        return false
      })
    }
    if (entry.selector.startsWith("aria-label=")) {
      const value = entry.selector.slice("aria-label=".length)
      return sourceFiles.some((file) => readFileSync(file, "utf8").includes(value))
    }
    const roleLabelMatch = entry.selector.match(/^role=(button|tab)\[name\^?="(.*)"\]$/)
    if (roleLabelMatch) {
      return sourceFiles.some((file) => readFileSync(file, "utf8").includes(roleLabelMatch[2]))
    }
    return false
  }
  const missing = manifestEntries.filter((entry) => {
    if (inventorySelectors.some((selector) => selectorMatchesManifest(entry.selector, selector))) return false
    return !fallbackPresence(entry)
  })
  const unexpected = inventorySelectors.filter(
    (selector) => !manifestEntries.some((entry) => selectorMatchesManifest(entry.selector, selector))
  )

  console.log(
    `[check-button-inventory] scanned_files=${sourceFiles.length} inventory_selectors=${inventorySelectors.length - unexpected.length} manifest_entries=${manifestEntries.length} raw_inventory_selectors=${inventorySelectors.length}`
  )

  if (missing.length > 0) {
    console.error(`[check-button-inventory] missing selectors in source: ${missing.length}`)
    for (const item of missing) console.error(`- ${item.id}: ${item.selector}`)
  }
  if (unexpected.length > 0) {
    console.error(`[check-button-inventory] selectors missing from manifest: ${unexpected.length}`)
    for (const selector of unexpected) console.error(`- ${selector}`)
  }
  if (missing.length > 0 || unexpected.length > 0) {
    process.exit(1)
  }

  console.log(
    "[check-button-inventory] pass: all manifest selectors are found in frontend source button inventory."
  )
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[check-button-inventory] error: ${message}`)
  process.exit(1)
}
