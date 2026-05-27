import { renderToStaticMarkup } from "react-dom/server"
import { it as caseIt, describe, expect } from "vitest"
import OnboardingTour from "./OnboardingTour"

describe("OnboardingTour accessibility contract", () => {
  caseIt("renders nothing when inactive", () => {
    const html = renderToStaticMarkup(<OnboardingTour active={false} onComplete={() => {}} />)
    expect(html).toBe("")
  })

  caseIt("renders a modal dialog with backdrop when active", () => {
    const html = renderToStaticMarkup(<OnboardingTour active onComplete={() => {}} />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain("tour-backdrop")
    expect(html).toContain('tabindex="-1"')
    expect(html).toMatch(/aria-labelledby="[^"]+"/)
    expect(html).toMatch(/aria-describedby="[^"]+"/)
  })
})
