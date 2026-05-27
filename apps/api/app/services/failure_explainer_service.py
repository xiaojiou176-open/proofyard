from __future__ import annotations

from apps.api.app.models.evidence_run import (
    FailureExplanation,
    FailureExplanationAnchor,
    FailureExplanationResponse,
)
def build_failure_explanation(
    evidence_run_service,
    run_id: str,
    candidate_run_id: str | None = None,
) -> FailureExplanationResponse:
    detail = evidence_run_service.get_run(run_id).run
    compare = (
        evidence_run_service.compare_runs(run_id, candidate_run_id).compare
        if candidate_run_id
        else None
    )

    anchors = [
        FailureExplanationAnchor(label="manifest", path=detail.manifest_path or "manifest.json"),
        FailureExplanationAnchor(label="summary", path=detail.summary_path or "reports/summary.json"),
    ]
    for path in detail.missing_paths[:3]:
        anchors.append(FailureExplanationAnchor(label="missing", path=path))

    next_actions: list[str] = []
    if detail.retention_state != "retained":
        next_actions.append(
            "Recreate or retain the missing evidence artifacts before treating this run as authoritative."
        )
    if compare and compare.summary_delta.failed_checks and compare.summary_delta.failed_checks > 0:
        next_actions.append(
            "Review the new failed checks introduced in the compare result before retrying."
        )
    next_actions.append("Use Recovery Center actions before falling back to raw logs or manual shell commands.")

    summary = (
        f"Run {detail.run_id} is in {detail.retention_state} state with gate status "
        f"{detail.gate_status or 'unknown'}."
    )
    if compare:
        summary += (
            f" Compared with {compare.candidate_run_id}, the failed check delta is "
            f"{compare.summary_delta.failed_checks if compare.summary_delta.failed_checks is not None else 'unknown'}."
        )

    uncertainty = (
        "Advisory-only explanation. This summary stays grounded in retained paths and compare output, "
        "but it does not replace direct inspection of the linked evidence or justify automatic recovery execution."
    )

    return FailureExplanationResponse(
        explanation=FailureExplanation(
            run_id=detail.run_id,
            summary=summary,
            uncertainty=uncertainty,
            evidence_anchors=anchors,
            next_actions=next_actions,
        )
    )
