import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import EvidenceRunComparePanel from "./EvidenceRunComparePanel"

describe("EvidenceRunComparePanel", () => {
  it("renders compare deltas for two runs", () => {
    const html = renderToStaticMarkup(
      <EvidenceRunComparePanel
        state="success"
        error=""
        compare={{
          baseline_run_id: "run-a",
          candidate_run_id: "run-b",
          compare_state: "partial_compare",
          baseline_retention_state: "retained",
          candidate_retention_state: "partial",
          gate_status_delta: { baseline: "passed", candidate: "failed" },
          summary_delta: { duration_ms: 600, failed_checks: 2, missing_artifacts: 1 },
          artifact_delta: {
            baseline_missing_paths: [],
            candidate_missing_paths: ["reports/proof.coverage.json"],
            report_path_changes: [],
            proof_path_changes: ["coverage"],
          },
        }}
      />
    )

    expect(html).toContain("Run Compare")
    expect(html).toContain("run-a vs run-b")
    expect(html).toContain("passed -&gt; failed")
    expect(html).toContain("600ms")
    expect(html).toContain("Partial compare")
    expect(html).toContain("State meaning")
  })
})
