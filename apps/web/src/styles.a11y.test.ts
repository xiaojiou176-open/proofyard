import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const STYLE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "styles.css")

function parseHexColor(css: string, varName: string): string {
  const lines = css.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(`${varName}:`)) continue
    const literalMatch = trimmed.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?/)
    if (literalMatch) {
      const raw = literalMatch[0].toLowerCase()
      if (raw.length === 4) {
        return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
      }
      return raw
    }
  }
  throw new Error(`Cannot find color variable: ${varName}`)
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function sRgbToLinear(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * sRgbToLinear(r) + 0.7152 * sRgbToLinear(g) + 0.0722 * sRgbToLinear(b)
}

function contrastRatio(foreground: string, background: string): number {
  const fg = luminance(foreground)
  const bg = luminance(background)
  const light = Math.max(fg, bg)
  const dark = Math.min(fg, bg)
  return (light + 0.05) / (dark + 0.05)
}

describe("styles accessibility contract", () => {
  it("keeps .error-text at WCAG AA contrast on light background", () => {
    const css = readFileSync(STYLE_FILE, "utf8")
    expect(css).toContain(".error-text")
    expect(css).toContain("color: var(--danger);")

    const danger = parseHexColor(css, "--danger")
    const bg = parseHexColor(css, "--bg")
    expect(contrastRatio(danger, bg)).toBeGreaterThanOrEqual(4.5)
  })
})
