import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import FailureExplainerPanel from "./FailureExplainerPanel"

describe("FailureExplainerPanel", () => {
  it("renders advisory explanation with anchors and next actions", () => {
    const html = renderToStaticMarkup(
      <FailureExplainerPanel
        state="success"
        error=""
        explanation={{
          run_id: "run-a",
          summary: "Run run-a is in retained state with gate status failed.",
          uncertainty: "Advisory only.",
          evidence_anchors: [{ label: "manifest", path: "manifest.json" }],
          next_actions: ["Use Recovery Center first."],
        }}
      />
    )

    expect(html).toContain("Explain this run")
    expect(html).toContain("Recommended next step")
    expect(html).toContain("Advisory only.")
    expect(html).toContain("manifest: manifest.json")
    expect(html).toContain("Use Recovery Center first.")
  })
})
