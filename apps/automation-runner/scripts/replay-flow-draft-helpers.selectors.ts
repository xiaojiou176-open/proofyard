import type { Page } from "playwright"

import type { FlowStep, SelectorAttempt, SelectorCandidate } from "./lib/replay-flow-types.js"

function escapeForDoubleQuotedSelector(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function escapeForSingleQuotedSelector(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function normalizeNameSelectorValue(raw: string): string {
  return raw.replace(/^\[name=['"]?/, "").replace(/['"]?\]$/, "").replace(/^name=/, "")
}

function normalizeSelector(selector: SelectorCandidate): string | null {
  if (selector.kind === "role") {
    const rolePattern = selector.value.match(/^([a-zA-Z0-9_-]+)(?:\[name=['"](.+)['"]\])?$/)
    if (!rolePattern) {
      return `role=button[name="${escapeForDoubleQuotedSelector(selector.value)}"]`
    }
    const [, role, name] = rolePattern
    if (name) {
      return `role=${role}[name="${escapeForDoubleQuotedSelector(name)}"]`
    }
    return `role=${role}`
  }
  if (selector.kind === "css") {
    return selector.value
  }
  if (selector.kind === "id") {
    return selector.value.startsWith("#") ? selector.value : `#${selector.value}`
  }
  if (selector.kind === "name") {
    return `[name='${escapeForSingleQuotedSelector(normalizeNameSelectorValue(selector.value))}']`
  }
  return null
}

function selectorCandidates(step: FlowStep): Array<{ index: number; candidate: SelectorCandidate }> {
  const selectors = step.target?.selectors ?? []
  if (selectors.length === 0) {
    return []
  }
  const preferredRaw = Number(process.env.FLOW_SELECTOR_INDEX ?? step.selected_selector_index ?? 0)
  const preferred = Number.isFinite(preferredRaw)
    ? Math.max(0, Math.min(selectors.length - 1, preferredRaw))
    : 0
  const ordered = [preferred, ...selectors.map((_, idx) => idx).filter((idx) => idx !== preferred)]
  return ordered.map((idx) => ({ index: idx, candidate: selectors[idx]! }))
}

export async function applyWithFallback(
  page: Page,
  step: FlowStep,
  action: (selector: string) => Promise<void>
): Promise<{
  ok: boolean
  detail: string
  matched_selector: string | null
  selector_index: number | null
  fallback_trail: SelectorAttempt[]
}> {
  const trail: SelectorAttempt[] = []
  const candidates = selectorCandidates(step)
  if (candidates.length === 0) {
    return {
      ok: false,
      detail: "no selector candidates",
      matched_selector: null,
      selector_index: null,
      fallback_trail: trail,
    }
  }
  for (const { index, candidate } of candidates) {
    const normalized = normalizeSelector(candidate)
    if (!normalized) {
      trail.push({
        selector_index: index,
        kind: candidate.kind,
        value: candidate.value,
        normalized: null,
        success: false,
        error: "selector kind not actionable",
      })
      continue
    }
    try {
      await action(normalized)
      trail.push({
        selector_index: index,
        kind: candidate.kind,
        value: candidate.value,
        normalized,
        success: true,
        error: null,
      })
      return {
        ok: true,
        detail: `matched selector[${index}] ${normalized}`,
        matched_selector: normalized,
        selector_index: index,
        fallback_trail: trail,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trail.push({
        selector_index: index,
        kind: candidate.kind,
        value: candidate.value,
        normalized,
        success: false,
        error: message,
      })
    }
  }
  return {
    ok: false,
    detail: "all selector attempts failed",
    matched_selector: null,
    selector_index: null,
    fallback_trail: trail,
  }
}

export async function waitPrecondition(
  page: Page,
  step: FlowStep
): Promise<{ ok: boolean; detail: string; fallback_trail: SelectorAttempt[] }> {
  if (step.action === "navigate") {
    return { ok: true, detail: "navigate step has no precondition wait", fallback_trail: [] }
  }
  const waitResult = await applyWithFallback(page, step, async (selector) => {
    await page.locator(selector).first().waitFor({ state: "visible", timeout: 5_000 })
  })
  return {
    ok: waitResult.ok,
    detail: waitResult.ok ? "precondition wait passed" : waitResult.detail,
    fallback_trail: waitResult.fallback_trail,
  }
}
