export type {
  ActionState,
  Command,
  CommandState,
  Task,
  TaskState,
} from "./features/command-center/types"

export type CommandCategory =
  | "init"
  | "pipeline"
  | "frontend"
  | "automation"
  | "maintenance"
  | "backend"
export type LogLevel = "info" | "success" | "warn" | "error"
export type LogEntry = {
  id: string
  ts: string
  level: LogLevel
  message: string
  commandId?: string
}
export type UiNotice = { id: string; level: LogLevel; message: string }
export type FetchTaskOptions = { background?: boolean }

export type DiagnosticsPayload = {
  uptime_seconds: number
  task_total: number
  task_counts: Record<string, number>
  metrics: { requests_total: number; rate_limited: number }
}

export type AlertsPayload = {
  state: "ok" | "degraded"
  failure_rate: number
  threshold: number
  completed: number
  failed: number
}

export type FlowPreviewStep = {
  step_id: string
  action: string
  url?: string | null
  value_ref?: string | null
  selector?: string | null
}

export type FlowPreviewPayload = {
  session_id: string | null
  start_url: string | null
  generated_at: string | null
  source_event_count: number
  step_count: number
  steps: FlowPreviewStep[]
}

export type FlowDraftDocumentPayload = {
  session_id: string | null
  flow: Record<string, unknown> | null
}

export type ReconstructionArtifactsPayload = {
  session_dir?: string
  video_path?: string
  har_path?: string
  html_path?: string
  html_content?: string
}

export type ReconstructionPreviewPayload = {
  preview_id: string
  flow_draft: Record<string, unknown>
  reconstructed_flow_quality: number
  step_confidence: number[]
  unresolved_segments: string[]
  manual_handoff_required: boolean
  unsupported_reason: string | null
  generator_outputs: Record<string, string>
}

export type ReconstructionGeneratePayload = {
  flow_id: string
  template_id: string
  run_id: string | null
  generator_outputs: Record<string, string>
  reconstructed_flow_quality: number
  step_confidence: number[]
  unresolved_segments: string[]
  manual_handoff_required: boolean
  unsupported_reason: string | null
}

export type ProfileResolvePayload = {
  profile: string
  video_signals: string[]
  dom_alignment_score: number
  har_alignment_score: number
  recommended_manual_checkpoints: string[]
  manual_handoff_required: boolean
  unsupported_reason: string | null
}

export type FlowSelectorCandidate = {
  kind: "role" | "css" | "id" | "name"
  value: string
  score: number
}

export type FlowEditableStep = {
  step_id: string
  action: "navigate" | "click" | "type" | string
  url?: string
  value_ref?: string
  selected_selector_index?: number
  target?: {
    selectors?: FlowSelectorCandidate[]
  }
}

export type FlowEditableDraft = {
  flow_id?: string
  session_id?: string
  start_url: string
  generated_at?: string
  source_event_count?: number
  steps: FlowEditableStep[]
}

export type StepEvidencePayload = {
  step_id: string
  action: string | null
  ok: boolean | null
  detail: string | null
  duration_ms: number | null
  matched_selector: string | null
  selector_index: number | null
  screenshot_before_path: string | null
  screenshot_after_path: string | null
  screenshot_before_data_url: string | null
  screenshot_after_data_url: string | null
  fallback_trail: Array<{
    selector_index: number
    kind: string
    value: string
    normalized: string | null
    success: boolean
    error: string | null
  }>
}

export type EvidenceTimelineItem = {
  step_id: string
  action: string | null
  ok: boolean | null
  detail: string | null
  duration_ms: number | null
  matched_selector: string | null
  selector_index: number | null
  screenshot_before_path: string | null
  screenshot_after_path: string | null
  screenshot_before_data_url: string | null
  screenshot_after_data_url: string | null
  fallback_trail: Array<{
    selector_index: number
    kind: string
    value: string
    normalized: string | null
    success: boolean
    error: string | null
  }>
}

export type EvidenceTimelinePayload = {
  items: EvidenceTimelineItem[]
}

export type EvidenceRegistryState = "available" | "empty" | "missing"

export type EvidenceRetentionState = "retained" | "partial" | "missing" | "empty"

export type EvidenceRunProvenance = {
  source: "canonical" | "automation" | "operator" | null
  correlation_id: string | null
  linked_run_ids: string[]
  linked_task_ids: string[]
}

export type EvidenceRunSummary = {
  run_id: string
  profile: string | null
  target_name: string | null
  target_type: string | null
  gate_status: string | null
  retention_state: EvidenceRetentionState
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  manifest_path: string | null
  summary_path: string | null
  missing_paths: string[]
  provenance: EvidenceRunProvenance
}

export type EvidenceRun = EvidenceRunSummary & {
  available_paths: string[]
  reports: Record<string, string>
  proof_paths: Record<string, string>
  evidence_index_count: number
  state_count: number
  registry_state: EvidenceRegistryState
  parse_error?: string | null
}

export type EvidenceRunListPayload = {
  runs: EvidenceRunSummary[]
  registry_state: EvidenceRegistryState
}

export type EvidenceRunLatestPayload = {
  run: EvidenceRun | null
  registry_state: EvidenceRegistryState
}

export type EvidenceRunCompare = {
  baseline_run_id: string
  candidate_run_id: string
  compare_state: "ready" | "partial_compare"
  baseline_retention_state: EvidenceRetentionState
  candidate_retention_state: EvidenceRetentionState
  gate_status_delta: {
    baseline: string | null
    candidate: string | null
  }
  summary_delta: {
    duration_ms: number | null
    failed_checks: number | null
    missing_artifacts: number
  }
  artifact_delta: {
    baseline_missing_paths: string[]
    candidate_missing_paths: string[]
    report_path_changes: string[]
    proof_path_changes: string[]
  }
}

export type EvidenceRunComparePayload = {
  compare: EvidenceRunCompare
}

export type EvidenceSharePack = {
  run_id: string
  retention_state: EvidenceRetentionState
  compare: EvidenceRunCompare | null
  markdown_summary: string
  issue_ready_snippet: string
  release_appendix: string
  json_bundle: {
    run_id: string
    retention_state: EvidenceRetentionState
    gate_status: string | null
    missing_paths: string[]
    compare: EvidenceRunCompare | null
  }
}

export type EvidenceSharePackPayload = {
  share_pack: EvidenceSharePack
}

export type PromotionCandidate = {
  run_id: string
  eligible: boolean
  retention_state: EvidenceRetentionState
  provenance_ready: boolean
  share_pack_ready: boolean
  compare_ready: boolean
  review_state: "candidate" | "review" | "approved"
  review_state_reason: string
  reason_codes: string[]
  release_reference: string
  showcase_reference: string
  supporting_share_pack_reference: string
}

export type PromotionCandidatePayload = {
  candidate: PromotionCandidate
}

export type HostedReviewWorkspace = {
  run_id: string
  workspace_state: "review_ready" | "review_partial"
  retention_state: EvidenceRetentionState
  compare_state: "ready" | "partial_compare" | "not_requested"
  review_summary: string
  next_review_step: string
  explanation: FailureExplanation
  share_pack: EvidenceSharePack
  compare: EvidenceRunCompare | null
  promotion_candidate: PromotionCandidate
  recommended_order: string[]
}

export type HostedReviewWorkspacePayload = {
  workspace: HostedReviewWorkspace
}

export type FailureExplanation = {
  run_id: string
  summary: string
  uncertainty: string
  evidence_anchors: Array<{ label: string; path: string }>
  next_actions: string[]
}

export type FailureExplanationPayload = {
  explanation: FailureExplanation
}

export type ConfigStudioField = {
  path: string
  label: string
  group: string
  field_type: "integer" | "number" | "boolean" | "string" | "enum"
  value: string | number | boolean | null
  description?: string | null
  min_value?: number | null
  max_value?: number | null
  enum_values: string[]
}

export type ConfigStudioReadonlyField = {
  path: string
  label: string
  value: unknown
}

export type ConfigStudioDocument = {
  kind: "profile" | "target"
  config_name: string
  file_path: string
  editable_fields: ConfigStudioField[]
  readonly_fields: ConfigStudioReadonlyField[]
  validation_summary: string[]
}

export type ProfileTargetStudioPayload = {
  trusted_mode: boolean
  profile_options: string[]
  target_options: string[]
  selected_profile: string
  selected_target: string
  profile: ConfigStudioDocument
  target: ConfigStudioDocument
}

export type ConfigStudioSavePayload = {
  document: ConfigStudioDocument
  saved: boolean
  audit: string[]
}

export type RunRecoveryAction = {
  action_id: string
  label: string
  description: string
  kind: "resume" | "replay" | "inspect" | "navigate"
  step_id: string | null
  requires_input: boolean
  input_label: string | null
  safety_level: "safe_suggestion" | "confirm_before_apply" | "manual_only"
  safety_reason: string | null
}

export type RunRecoveryPlan = {
  run_id: string
  status: string
  headline: string
  summary: string
  reason_code: string | null
  primary_action: RunRecoveryAction | null
  actions: RunRecoveryAction[]
  suggested_step_id: string | null
  linked_task_id: string | null
  correlation_id: string | null
}

export type RunRecoveryPlanPayload = {
  plan: RunRecoveryPlan
}

export type TemplateReadinessStep = {
  step_id: string
  reasons: string[]
  confidence: number | null
  selector_score: number | null
}

export type TemplateReadiness = {
  template_id: string
  flow_id: string
  readiness_score: number
  risk_level: "low" | "medium" | "high"
  step_count: number
  average_confidence: number
  selector_risk_count: number
  manual_gate_density: number
  low_confidence_steps: string[]
  selectorless_steps: string[]
  high_risk_steps: TemplateReadinessStep[]
}

export type UniversalSession = {
  session_id: string
  start_url: string
  mode: "manual" | "ai"
  owner: string | null
  started_at: string
  finished_at: string | null
  artifacts_index: Record<string, string>
}

export type UniversalFlow = {
  flow_id: string
  session_id: string
  version: number
  quality_score: number
  start_url: string
  source_event_count: number
  steps: FlowEditableStep[]
  created_at: string
  updated_at: string
}

export type UniversalTemplate = {
  template_id: string
  flow_id: string
  name: string
  params_schema: Array<{
    key: string
    type: "string" | "secret" | "enum" | "regex" | "email"
    required: boolean
    description?: string | null
    enum_values?: string[]
    pattern?: string | null
  }>
  defaults: Record<string, string>
  policies: {
    retries: number
    timeout_seconds: number
    otp: {
      required: boolean
      provider: "manual" | "gmail" | "imap" | "vonage"
      timeout_seconds: number
      regex: string
      sender_filter?: string | null
      subject_filter?: string | null
    }
    branches: Record<string, unknown>
  }
  created_by: string | null
  created_at: string
  updated_at: string
}

export type UniversalRun = {
  run_id: string
  template_id: string
  status: "queued" | "running" | "waiting_user" | "waiting_otp" | "success" | "failed" | "cancelled"
  wait_context?: {
    reason_code?: string | null
    at_step_id?: string | null
    after_step_id?: string | null
    resume_from_step_id?: string | null
    resume_hint?: string | null
    provider_domain?: string | null
    gate_required_by_policy?: boolean | null
  } | null
  step_cursor: number
  params: Record<string, string>
  task_id: string | null
  last_error: string | null
  artifacts_ref: Record<string, string>
  correlation_id?: string | null
  linked_evidence_run_ids?: string[]
  created_at: string
  updated_at: string
  logs: Array<{ ts: string; level: "info" | "warn" | "error"; message: string }>
}

export type RunRecordSource = "command" | "template"

export type RunRecordDetailSection = "source" | "status" | "progress" | "timeline" | "output"

export type RunRecordViewHint = {
  title: "Run Record Details"
  sections: RunRecordDetailSection[]
}

// UI label mapping: protocol fields stay unchanged while display copy stays beginner-friendly.
export const RUN_RECORD_SOURCE_LABEL: Record<RunRecordSource, string> = {
  command: "Command Run",
  template: "Template Run",
}

export const RUN_RECORD_DETAIL_SECTION_LABEL: Record<RunRecordDetailSection, string> = {
  source: "Source",
  status: "Status",
  progress: "Progress",
  timeline: "Timeline",
  output: "Output",
}

export const UNIVERSAL_RUN_STATUS_LABEL: Record<UniversalRun["status"], string> = {
  queued: "Queued",
  running: "Running",
  waiting_user: "Waiting for User Input",
  waiting_otp: "Waiting for OTP",
  success: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
}
