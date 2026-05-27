import { renderToStaticMarkup } from "react-dom/server"
import { it as caseIt, describe, expect } from "vitest"
import HelpPanel from "./HelpPanel"

describe("HelpPanel accessibility contract", () => {
  caseIt("renders as modal dialog with labels and description", () => {
    const html = renderToStaticMarkup(
      <HelpPanel activeView="launch" onClose={() => {}} onRestartTour={() => {}} />
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toMatch(/aria-labelledby="[^"]+"/)
    expect(html).toMatch(/aria-describedby="[^"]+"/)
    expect(html).toContain('aria-label="Close help panel"')
  })
})
