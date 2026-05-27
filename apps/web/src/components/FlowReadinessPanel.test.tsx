import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import FlowReadinessPanel from "./FlowReadinessPanel"

describe("FlowReadinessPanel", () => {
  it("renders readiness metrics and high-risk steps", () => {
    const html = renderToStaticMarkup(
      <FlowReadinessPanel
        state="success"
        error=""
        readiness={{
          template_id: "tpl-1",
          flow_id: "flow-1",
          readiness_score: 61,
          risk_level: "medium",
          step_count: 3,
          average_confidence: 0.73,
          selector_risk_count: 2,
          manual_gate_density: 0.333,
          low_confidence_steps: ["s1"],
          selectorless_steps: ["s3"],
          high_risk_steps: [
            {
              step_id: "s1",
              reasons: ["low_confidence", "weak_selector"],
              confidence: 0.5,
              selector_score: 40,
            },
          ],
        }}
      />
    )

    expect(html).toContain("Template Readiness")
    expect(html).toContain("Reuse verdict")
    expect(html).toContain("Review before reuse")
    expect(html).toContain("This template is reusable, but it still needs a human review")
    expect(html).toContain("61")
    expect(html).toContain("medium")
    expect(html).toContain("Why this is the verdict")
    expect(html).toContain("Low-confidence step")
    expect(html).toContain("Weak selector coverage")
    expect(html).toContain("Inspect first")
    expect(html).toContain("s1: Low-confidence step, Weak selector coverage")
    expect(html).toContain("Suggested next step")
  })
})
