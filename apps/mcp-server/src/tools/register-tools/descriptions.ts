export const CORE_TOOL_DESCRIPTIONS = {
  backendRuntime: `Goal:
- Manage the MCP-owned backend runtime lifecycle and health state.
Use When:
- The backend is not ready before orchestration or API calls.
Required Inputs:
- action: start | status | stop.
- preferredPort: optional when action=start.
Call Order:
- 1) start 2) status (optional check) 3) stop when cleanup is needed.
Success Output:
- { ok: runtime.ok, action, runtime } with pid/baseUrl/health fields.
If Failed:
- Read detail, then retry start or inspect backend logs/runtime files.
Do Not:
- Do not call stop unless you intentionally want to terminate the managed backend runtime.`,
  apiSessions: `Goal:
- Operate the session lifecycle through one endpoint wrapper.
Use When:
- You need to list sessions, start a capture session, or finish a session.
Required Inputs:
- action: list | start | finish.
- start requires startUrl; finish requires sessionId.
Call Order:
- 1) start (or list existing) 2) use session_id downstream 3) finish when done.
Success Output:
- { ok: true, action, payload } where payload is a session list or session object.
If Failed:
- detail explains missing inputs or apps/api/API errors.
Do Not:
- Do not call finish without a valid sessionId.`,
  registerOrchestrate: `Goal:
- Execute the register closed-loop flow: prepare | teach | clone | resume.
Use When:
- You need end-to-end onboarding/register automation with the template + run lifecycle.
Required Inputs:
- action is required; other fields depend on the selected action.
- teach requires startUrl; clone requires templateId; resume requires runId.
Call Order:
- 1) prepare -> 2) teach -> 3) clone -> 4) resume (OTP or continuation).
Success Output:
- Returns action-specific objects with runtime plus created/imported run/template data.
If Failed:
- detail explains validation, API, or polling errors; waiting_otp may require otpCode + resume.
Do Not:
- Do not skip action-specific required fields.`,
  registerState: `Goal:
- Read a compact state snapshot of runtime + session + flow + template + run.
Use When:
- You need the current closed-loop progress or post-run state inspection.
Required Inputs:
- All inputs are optional; provide IDs to pin exact entities.
Call Order:
- Usually after prepare/teach/clone/resume to confirm the latest state.
Success Output:
- { ok: true, runtime, session, flow, template, run }.
If Failed:
- detail contains the apps/api/API retrieval error reason.
Do Not:
- Do not assume missing IDs mean an error; null is valid when an entity is absent.`,
  apiFlows: `Goal:
- Provide a unified flows wrapper for list/get/import_latest/create/update.
Use When:
- You need to manage flow records around session teaching/import/update.
Required Inputs:
- action is required; flowId is required for get/update.
- create requires sessionId + startUrl.
- update requires flowId and at least one mutable field (startUrl/steps).
Call Order:
- Common path: import_latest or create -> get -> update if needed.
Success Output:
- Returns the raw backend payload in MCP text content while preserving API fields.
If Failed:
- Throws clear missing-input errors or returns an API error payload with isError=true.
Do Not:
- Do not call get/update without flowId.`,
  apiTemplates: `Goal:
- Provide a unified templates wrapper for list/get/export/create/update.
Use When:
- You need to build or maintain reusable automation template definitions.
Required Inputs:
- action is required; templateId is required for get/export/update.
- create requires flowId + name.
- update requires templateId and at least one mutable field (name/paramsSchema/defaults/policies).
Call Order:
- Typical: create -> get/export -> update, or list first for discovery.
Success Output:
- Returns the backend template payload unchanged in structure.
If Failed:
- Missing required IDs raise explicit errors; API failures return isError.
Do Not:
- Do not use update/export/get without templateId.`,
  apiRuns: `Goal:
- Provide a unified runs wrapper for list/get/create/otp/cancel.
Use When:
- You need to create and monitor execution runs, submit OTP, or cancel a run.
Required Inputs:
- action is required; runId is required for get/otp/cancel.
- create requires templateId.
- otp requires runId + otpCode.
Call Order:
- Normal path: create -> get/list polling -> otp only when status is waiting_otp -> cancel only if needed.
Success Output:
- Returns the backend run payload with compatible fields for orchestration.
If Failed:
- Missing runId/action mismatch errors are explicit; API failures set isError.
Do Not:
- Do not call otp/cancel/get without runId.`,
} as const

export const RUN_TOOL_DESCRIPTIONS = {
  read: `Goal:
- Provide a unified read entrypoint for run artifacts, manifests, and repo docs.
Use When:
- You need one stable tool instead of choosing among uiq_read_artifact, uiq_read_manifest, and uiq_read_repo_doc.
Required Inputs:
- source is required: artifact | manifest | repo_doc.
- artifact needs runId + relativePath; manifest needs runId; repo_doc needs relativePath.
Call Order:
- 1) choose source 2) provide required ids/path 3) parse the returned text payload.
Success Output:
- JSON with ok=true and normalized fields (source/runId/relativePath/text).
If Failed:
- Returns { ok:false, detail } with isError=true for validation, path, or read errors.
Do Not:
- Do not pass path traversal payloads or omit source-specific required fields.`,
  qualityRead: `Goal:
- Provide a unified quality reader for a11y, perf, visual, and security reports.
Use When:
- You need one tool to fetch quality slices from the same run.
Required Inputs:
- kind is required: a11y | perf | visual | security.
- runId is optional (fallback latest); topN is optional for a11y.
Call Order:
- 1) choose kind 2) optionally pass runId/topN 3) consume the structured summary.
Success Output:
- Returns the same structured payload shape as the existing dedicated quality tools.
If Failed:
- Returns { ok:false, detail } with isError=true when runs/artifacts are invalid.
Do Not:
- Do not assume the latest run exists; provide runId when determinism is required.`,
  run: `Goal:
- Provide a unified non-stream run entrypoint for profile or command mode.
Use When:
- You need one stable runner API while preserving legacy run tool compatibility.
Required Inputs:
- mode is required: profile | command.
- profile mode requires profile + target; command mode requires command.
Call Order:
- 1) select mode 2) pass mode-specific required fields 3) inspect the run result.
Success Output:
- Same run envelope: ok/detail/stdout/stderr/runId/manifest/exitCode + warnings.
If Failed:
- Invalid inputs return { ok:false, detail } with isError=true; execution errors preserve the run envelope and mark isError=true.
Do Not:
- Do not mix profile and command requirements; follow the selected mode strictly.`,
  runAndReport: `Goal:
- Provide a unified execution + report workflow for stream, overview, bundle, failures, and full modes.
Use When:
- You need a single endpoint to run and/or retrieve gate/report artifacts.
Required Inputs:
- mode is required.
- stream/full require runMode profile|command plus mode-specific run inputs.
- overview/bundle/failures use optional runId (fallback latest).
Call Order:
- stream: run only; overview/failures/bundle: read only; full: run then return overview + failures + bundle.
Success Output:
- Returns mode-aligned structured JSON; full returns stream + overview + failures + bundle.
If Failed:
- Validation, read, or runtime errors return { ok:false, detail } with isError=true.
Do Not:
- Do not use full mode without runnable inputs; provide runMode and the required fields.`,
  proof: `Goal:
- Provide unified proof operations for proof campaigns: run/read/export/diff.
Use When:
- You need to build, inspect, export, or compare campaign-level proof artifacts.
Required Inputs:
- action is required.
- run uses optional campaignId/model/runIds; diff requires campaignIdA + campaignIdB.
- read/export use optional campaignId (fallback latest).
Call Order:
- run -> read/export -> diff (optional baseline or cross-campaign comparison).
Success Output:
- Returns action-specific structured payloads and persisted artifact paths when applicable.
If Failed:
- Returns { ok:false, detail } with isError=true for validation or artifact errors.
Do Not:
- Do not pass invalid campaign identifiers or omit required diff campaign ids.`,
  computerUseRun: `Goal:
- Execute the CLI computer-use command through a constrained MCP entrypoint.
Use When:
- You need AI computer-use execution with task text plus optional step/speed controls.
Required Inputs:
- task is required; maxSteps/speedMode/runId are optional.
Call Order:
- 1) call with task -> 2) inspect runId/stdout/stderr -> 3) follow up with run artifact tools if needed.
Success Output:
- Same run result envelope as uiq_run_command/uiq_run_profile (ok/detail/stdout/stderr/runId/manifest/exitCode).
If Failed:
- Returns command failure detail (for example invalid task/runId) with isError=true.
Do Not:
- Do not pass unrelated command flags; this tool only controls computer-use options.`,
} as const
