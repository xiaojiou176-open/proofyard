from __future__ import annotations

from apps.api.app.models.flow import FlowRecord
from apps.api.app.models.template import TemplateReadiness, TemplateReadinessStep


def build_template_readiness(flow: FlowRecord) -> tuple[int, float, int, float, list[str], list[str], list[TemplateReadinessStep]]:
    step_count = len(flow.steps)
    if step_count == 0:
        return 0, 0.0, 0, 0.0, [], [], []

    low_confidence_steps: list[str] = []
    selectorless_steps: list[str] = []
    high_risk_steps: list[TemplateReadinessStep] = []
    manual_gate_steps = 0
    selector_risk_count = 0
    confidence_total = 0.0

    for step in flow.steps:
        confidence_total += step.confidence
        reasons: list[str] = []
        selector_score = None

        selectors = step.target.selectors if step.target else []
        if selectors:
            selector_score = max(selector.score for selector in selectors)
            if selector_score < 60:
                selector_risk_count += 1
                reasons.append("weak_selector")
        else:
            selectorless_steps.append(step.step_id)
            selector_risk_count += 1
            reasons.append("missing_selector")

        if step.manual_handoff_required or step.action == "manual_gate":
            manual_gate_steps += 1
            reasons.append("manual_gate")

        if step.confidence < 0.75:
            low_confidence_steps.append(step.step_id)
            reasons.append("low_confidence")

        if reasons:
            high_risk_steps.append(
                TemplateReadinessStep(
                    step_id=step.step_id,
                    reasons=reasons,
                    confidence=step.confidence,
                    selector_score=selector_score,
                )
            )

    average_confidence = round(confidence_total / step_count, 3)
    manual_gate_density = round(manual_gate_steps / step_count, 3)
    readiness_score = max(
        0,
        min(
            100,
            int(
                round(
                    flow.quality_score
                    if flow.quality_score > 0
                    else (average_confidence * 100)
                    - selector_risk_count * 8
                    - manual_gate_steps * 5
                )
            ),
        ),
    )
    return (
        readiness_score,
        average_confidence,
        selector_risk_count,
        manual_gate_density,
        low_confidence_steps,
        selectorless_steps,
        high_risk_steps,
    )


def risk_level_for_score(score: int) -> str:
    if score >= 80:
        return "low"
    if score >= 55:
        return "medium"
    return "high"


def get_template_readiness(service, template_id: str, requester: str | None = None) -> TemplateReadiness:
    template = service.get_template(template_id, requester=requester)
    flow = service.get_flow(template.flow_id, requester=requester)
    (
        readiness_score,
        average_confidence,
        selector_risk_count,
        manual_gate_density,
        low_confidence_steps,
        selectorless_steps,
        high_risk_steps,
    ) = build_template_readiness(flow)
    return TemplateReadiness(
        template_id=template.template_id,
        flow_id=flow.flow_id,
        readiness_score=readiness_score,
        risk_level=risk_level_for_score(readiness_score),  # type: ignore[arg-type]
        step_count=len(flow.steps),
        average_confidence=average_confidence,
        selector_risk_count=selector_risk_count,
        manual_gate_density=manual_gate_density,
        low_confidence_steps=low_confidence_steps,
        selectorless_steps=selectorless_steps,
        high_risk_steps=high_risk_steps,
    )
