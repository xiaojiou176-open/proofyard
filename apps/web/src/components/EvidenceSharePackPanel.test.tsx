import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import EvidenceSharePackPanel from "./EvidenceSharePackPanel"

describe("EvidenceSharePackPanel", () => {
  it("renders markdown, issue snippet and release appendix", () => {
    const html = renderToStaticMarkup(
      <EvidenceSharePackPanel
        state="success"
        error=""
        sharePack={{
          run_id: "run-a",
          retention_state: "partial",
          compare: null,
          markdown_summary: "## Evidence Share Pack",
          issue_ready_snippet: "### Failure Digest",
          release_appendix: "### Evidence Appendix",
          json_bundle: {
            run_id: "run-a",
            retention_state: "partial",
            gate_status: "failed",
            missing_paths: ["reports/proof.coverage.json"],
            compare: null,
          },
        }}
      />
    )

    expect(html).toContain("Evidence Share Pack")
    expect(html).toContain("Failure Digest")
    expect(html).toContain("Evidence Appendix")
  })
})
