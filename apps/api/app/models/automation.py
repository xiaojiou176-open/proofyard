from __future__ import annotations

from datetime import datetime
from typing import Any
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

TaskStatus = Literal["queued", "running", "success", "failed", "cancelled"]


class CommandDefinition(BaseModel):
    command_id: str
    title: str
    description: str
    tags: list[str] = Field(default_factory=list)
    accepts_env: bool = True


class RunCommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command: str
    params: "RunCommandParams | None" = None

    @property
    def command_id(self) -> str:
        return self.command

    @property
    def resolved_params(self) -> dict[str, str]:
        if self.params is None:
            return {}
        return self.params.to_env_dict()


class RunCommandParams(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    base_url: str | None = Field(
        default=None,
        alias="UIQ_BASE_URL",
        validation_alias=AliasChoices("UIQ_BASE_URL", "BASE_URL"),
    )
    start_url: str | None = Field(default=None, alias="START_URL")
    success_selector: str | None = Field(default=None, alias="SUCCESS_SELECTOR")
    ai_provider: str | None = Field(default=None, alias="AI_PROVIDER")
    ai_speed_mode: str | None = Field(default=None, alias="AI_SPEED_MODE")
    video_analyzer_provider: str | None = Field(default=None, alias="VIDEO_ANALYZER_PROVIDER")
    midscene_model_name: str | None = Field(default=None, alias="MIDSCENE_MODEL_NAME")
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model_primary: str | None = Field(default=None, alias="GEMINI_MODEL_PRIMARY")
    gemini_model_flash: str | None = Field(default=None, alias="GEMINI_MODEL_FLASH")
    gemini_embed_model: str | None = Field(default=None, alias="GEMINI_EMBED_MODEL")
    gemini_thinking_level: str | None = Field(default=None, alias="GEMINI_THINKING_LEVEL")
    gemini_include_thoughts: str | None = Field(default=None, alias="GEMINI_INCLUDE_THOUGHTS")
    gemini_context_cache_ttl_seconds: str | None = Field(
        default=None, alias="GEMINI_CONTEXT_CACHE_TTL_SECONDS"
    )
    gemini_media_resolution_default: str | None = Field(
        default=None, alias="GEMINI_MEDIA_RESOLUTION_DEFAULT"
    )
    gemini_tool_mode: str | None = Field(default=None, alias="GEMINI_TOOL_MODE")
    midscene_strict: str | None = Field(default=None, alias="MIDSCENE_STRICT")
    register_password: str | None = Field(default=None, alias="REGISTER_PASSWORD")
    headless: str | None = Field(default=None, alias="HEADLESS")
    flow_step_id: str | None = Field(default=None, alias="FLOW_STEP_ID")
    flow_from_step_id: str | None = Field(default=None, alias="FLOW_FROM_STEP_ID")
    flow_replay_preconditions: str | None = Field(default=None, alias="FLOW_REPLAY_PRECONDITIONS")
    flow_selector_index: str | None = Field(default=None, alias="FLOW_SELECTOR_INDEX")
    flow_input: str | None = Field(default=None, alias="FLOW_INPUT")
    flow_secret_input: str | None = Field(default=None, alias="FLOW_SECRET_INPUT")
    flow_otp_code: str | None = Field(default=None, alias="FLOW_OTP_CODE")
    automation_idempotency_key: str | None = Field(default=None, alias="AUTOMATION_IDEMPOTENCY_KEY")
    automation_idempotency_replay: str | None = Field(
        default=None, alias="AUTOMATION_IDEMPOTENCY_REPLAY"
    )
    stripe_card_number: str | None = Field(default=None, alias="stripeCardNumber")
    stripe_exp_month: str | None = Field(default=None, alias="stripeExpMonth")
    stripe_exp_year: str | None = Field(default=None, alias="stripeExpYear")
    stripe_cvc: str | None = Field(default=None, alias="stripeCvc")
    stripe_cardholder_name: str | None = Field(default=None, alias="stripeCardholderName")
    stripe_postal_code: str | None = Field(default=None, alias="stripePostalCode")
    stripe_country: str | None = Field(default=None, alias="stripeCountry")

    @field_validator("*")
    @classmethod
    def validate_param_value_length(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if len(value) > 2048:
            raise ValueError("params value exceeds max length (2048)")
        return value

    def to_env_dict(self) -> dict[str, str]:
        serialized = self.model_dump(by_alias=True, exclude_none=True)
        return {key: value for key, value in serialized.items() if isinstance(value, str)}


class TaskSnapshot(BaseModel):
    task_id: str
    command: str
    command_id: str
    status: TaskStatus
    requested_by: str | None = None
    attempt: int = 1
    max_attempts: int = 1
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    exit_code: int | None = None
    message: str | None = None
    output_tail: str = ""
    idempotency_key: str | None = None
    replay_of_task_id: str | None = None
    correlation_id: str | None = None
    linked_run_id: str | None = None

class RunCommandResponse(BaseModel):
    task: TaskSnapshot


class TaskListResponse(BaseModel):
    tasks: list[TaskSnapshot]


class CommandListResponse(BaseModel):
    commands: list[CommandDefinition]


class FlowPreviewStep(BaseModel):
    step_id: str
    action: str
    url: str | None = None
    value_ref: str | None = None
    selector: str | None = None


class FlowPreviewResponse(BaseModel):
    session_id: str | None = None
    start_url: str | None = None
    generated_at: datetime | None = None
    source_event_count: int = 0
    step_count: int = 0
    steps: list[FlowPreviewStep] = Field(default_factory=list)


class FlowDraftDocumentResponse(BaseModel):
    session_id: str | None = None
    flow: dict[str, Any] | None = None


class FlowDraftDocumentUpdateRequest(BaseModel):
    flow: dict[str, Any]


class ReplayLatestStepRequest(BaseModel):
    step_id: str


class ReplayFromStepRequest(BaseModel):
    step_id: str
    replay_preconditions: bool = False


class SelectorAttemptResponse(BaseModel):
    selector_index: int | None = None
    kind: str
    value: str
    normalized: str | None = None
    success: bool
    error: str | None = None


class StepEvidenceResponse(BaseModel):
    step_id: str
    action: str | None = None
    ok: bool | None = None
    detail: str | None = None
    duration_ms: int | None = None
    matched_selector: str | None = None
    selector_index: int | None = None
    screenshot_before_path: str | None = None
    screenshot_after_path: str | None = None
    screenshot_before_data_url: str | None = None
    screenshot_after_data_url: str | None = None
    fallback_trail: list[SelectorAttemptResponse] = Field(default_factory=list)


class EvidenceTimelineItemResponse(BaseModel):
    step_id: str
    action: str | None = None
    ok: bool | None = None
    detail: str | None = None
    duration_ms: int | None = None
    matched_selector: str | None = None
    selector_index: int | None = None
    screenshot_before_path: str | None = None
    screenshot_after_path: str | None = None
    screenshot_before_data_url: str | None = None
    screenshot_after_data_url: str | None = None
    fallback_trail: list[SelectorAttemptResponse] = Field(default_factory=list)


class EvidenceTimelineResponse(BaseModel):
    items: list[EvidenceTimelineItemResponse] = Field(default_factory=list)


class ReconstructionArtifactsRequest(BaseModel):
    """Artifact paths are accepted only when they resolve under the automation runtime root."""

    session_id: str | None = None
    session_dir: str | None = Field(
        default=None, description="Runtime-root-bound session directory path."
    )
    video_path: str | None = Field(
        default=None, description="Runtime-root-bound video artifact path."
    )
    har_path: str | None = Field(default=None, description="Runtime-root-bound HAR artifact path.")
    html_path: str | None = Field(
        default=None, description="Runtime-root-bound HTML snapshot path."
    )
    html_content: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class OrchestrateFromArtifactsRequest(BaseModel):
    artifacts: ReconstructionArtifactsRequest
    video_analysis_mode: Literal["gemini"] = "gemini"
    extractor_strategy: Literal["strict", "balanced", "aggressive"] = "balanced"
    auto_refine_iterations: int = 3
    template_name: str = "reconstructed-template"
    create_run: bool = False
    run_params: dict[str, str] = Field(default_factory=dict)

    @field_validator("auto_refine_iterations")
    @classmethod
    def validate_iterations(cls, value: int) -> int:
        if value < 1:
            return 1
        if value > 10:
            return 10
        return value


class OrchestrateFromArtifactsResponse(BaseModel):
    template_id: str
    run_id: str | None = None
    reconstructed_flow_quality: int
    step_confidence: list[float] = Field(default_factory=list)
    unresolved_segments: list[str] = Field(default_factory=list)
    generator_outputs: dict[str, str] = Field(default_factory=dict)
    manual_handoff_required: bool = False
    unsupported_reason: str | None = None


class ProfileResolveRequest(BaseModel):
    artifacts: ReconstructionArtifactsRequest
    extractor_strategy: Literal["strict", "balanced", "aggressive"] = "balanced"


class ProfileResolveResponse(BaseModel):
    profile: str
    video_signals: list[str] = Field(default_factory=list)
    dom_alignment_score: float = 0.0
    har_alignment_score: float = 0.0
    recommended_manual_checkpoints: list[str] = Field(default_factory=list)
    manual_handoff_required: bool = False
    unsupported_reason: str | None = None


class ReconstructionPreviewStep(BaseModel):
    step_id: str
    action: str
    url: str | None = None
    value_ref: str | None = None
    evidence_ref: str | None = None
    confidence: float = 1.0
    source_engine: str = "gemini"
    manual_handoff_required: bool = False
    unsupported_reason: str | None = None


class ReconstructionPreviewRequest(BaseModel):
    artifacts: ReconstructionArtifactsRequest
    video_analysis_mode: Literal["gemini"] = "gemini"
    extractor_strategy: Literal["strict", "balanced", "aggressive"] = "balanced"
    auto_refine_iterations: int = 3


class ReconstructionPreviewResponse(BaseModel):
    preview_id: str
    flow_draft: dict[str, Any]
    reconstructed_flow_quality: int
    step_confidence: list[float] = Field(default_factory=list)
    unresolved_segments: list[str] = Field(default_factory=list)
    manual_handoff_required: bool = False
    unsupported_reason: str | None = None
    generator_outputs: dict[str, str] = Field(default_factory=dict)


class ReconstructionGenerateRequest(BaseModel):
    preview_id: str | None = None
    preview: ReconstructionPreviewResponse | None = None
    template_name: str = "reconstructed-template"
    create_run: bool = False
    run_params: dict[str, str] = Field(default_factory=dict)


class ReconstructionGenerateResponse(BaseModel):
    flow_id: str
    template_id: str
    run_id: str | None = None
    generator_outputs: dict[str, str] = Field(default_factory=dict)
    reconstructed_flow_quality: int
    step_confidence: list[float] = Field(default_factory=list)
    unresolved_segments: list[str] = Field(default_factory=list)
    manual_handoff_required: bool = False
    unsupported_reason: str | None = None
