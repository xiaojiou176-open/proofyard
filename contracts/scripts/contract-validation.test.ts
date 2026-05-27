import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import YAML from "yaml";

type OpenApiSpec = {
  paths?: Record<string, Record<string, Record<string, unknown>>>;
  components?: {
    schemas?: Record<string, unknown>;
  };
};

type Operation = {
  operationId: string;
  method: string;
  path: string;
};

const openapiPath = resolve("contracts/openapi/api.yaml");
const generatedClientPath = resolve("apps/web/src/api-gen/client.ts");
const generatedAutomationApiPath = resolve("apps/web/src/api-gen/api/automation.ts");
const generatedHealthApiPath = resolve("apps/web/src/api-gen/api/health.ts");
const generatedCommandTowerApiPath = resolve("apps/web/src/api-gen/api/command-tower.ts");
const generatedMswPath = resolve("apps/web/msw/handlers.ts");

function loadSpec(): OpenApiSpec {
  return YAML.parse(readFileSync(openapiPath, "utf8")) as OpenApiSpec;
}

function readRefName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const ref = (value as { $ref?: unknown }).$ref;
  if (typeof ref !== "string") return null;
  const match = ref.match(/^#\/components\/schemas\/(.+)$/);
  return match ? match[1] : null;
}

function getOperation(spec: OpenApiSpec, method: string, path: string): Record<string, unknown> {
  const operation = spec.paths?.[path]?.[method.toLowerCase()];
  assert.ok(operation, `Missing operation ${method.toUpperCase()} ${path}`);
  return operation;
}

function getOperations(spec: OpenApiSpec): Operation[] {
  const operations: Operation[] = [];
  const httpMethods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!httpMethods.has(method.toLowerCase())) {
        continue;
      }
      const opId = (operation.operationId as string | undefined)?.trim();
      assert.ok(opId, `operationId is required for ${method.toUpperCase()} ${path}`);
      operations.push({
        operationId: opId!,
        method: method.toUpperCase(),
        path
      });
    }
  }
  return operations;
}

function getResponseSchemaRef(operation: Record<string, unknown>, statusCode: string): string | null {
  const responses = operation.responses as Record<string, unknown> | undefined;
  const status = responses?.[statusCode] as Record<string, unknown> | undefined;
  const content = status?.content as Record<string, unknown> | undefined;
  const appJson = content?.["application/json"] as Record<string, unknown> | undefined;
  return readRefName(appJson?.schema);
}

function resolveSchema(spec: OpenApiSpec, schema: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!schema) return null;
  const refName = readRefName(schema);
  if (!refName) return schema;
  const resolved = spec.components?.schemas?.[refName];
  if (!resolved || typeof resolved !== "object") return null;
  return resolved as Record<string, unknown>;
}

function getResponseSchema(spec: OpenApiSpec, operation: Record<string, unknown>, statusCode: string): Record<string, unknown> | null {
  const responses = operation.responses as Record<string, unknown> | undefined;
  const status = responses?.[statusCode] as Record<string, unknown> | undefined;
  const content = status?.content as Record<string, unknown> | undefined;
  const appJson = content?.["application/json"] as Record<string, unknown> | undefined;
  if (!appJson) return null;
  const schema = appJson.schema as Record<string, unknown> | undefined;
  return resolveSchema(spec, schema);
}

function getResponseMediaTypes(operation: Record<string, unknown>, statusCode: string): string[] {
  const responses = operation.responses as Record<string, unknown> | undefined;
  const status = responses?.[statusCode] as Record<string, unknown> | undefined;
  const content = status?.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== "object") return [];
  return Object.keys(content);
}

function getRequestSchemaRef(operation: Record<string, unknown>): string | null {
  const requestBody = operation.requestBody as Record<string, unknown> | undefined;
  const content = requestBody?.content as Record<string, unknown> | undefined;
  const appJson = content?.["application/json"] as Record<string, unknown> | undefined;
  return readRefName(appJson?.schema);
}

function parseGeneratedOperations(source: string, constName: string): Operation[] {
  const prefix = `export const ${constName} = `;
  const start = source.indexOf(prefix);
  assert.ok(start >= 0, `Generated file must export ${constName}`);
  const asConst = " as const;";
  const end = source.indexOf(asConst, start);
  assert.ok(end >= 0, `Generated file ${constName} must end with 'as const;'`);
  const raw = source.slice(start + prefix.length, end).trim();
  return JSON.parse(raw) as Operation[];
}

test("OpenAPI covers run/report/automation core contract schemas", () => {
  const spec = loadSpec();

  const requiredPaths = [
    "GET /api/automation/commands",
    "GET /api/automation/tasks",
    "GET /api/automation/tasks/{task_id}",
    "POST /api/automation/run",
    "POST /api/automation/tasks/{task_id}/cancel",
    "GET /api/runs",
    "POST /api/runs",
    "GET /api/runs/{run_id}",
    "POST /api/runs/{run_id}/otp",
    "GET /api/runs/{run_id}/recover-plan",
    "POST /api/runs/{run_id}/cancel",
    "GET /api/templates/{template_id}/readiness",
    "GET /api/evidence-runs",
    "GET /api/evidence-runs/latest",
    "GET /api/evidence-runs/{run_id}",
    "GET /api/evidence-runs/{run_id}/compare/{candidate_run_id}",
    "GET /api/evidence-runs/{run_id}/share-pack",
    "GET /api/evidence-runs/{run_id}/explain",
    "GET /api/evidence-runs/{run_id}/promotion-candidate",
    "GET /health/diagnostics"
  ];

  for (const entry of requiredPaths) {
    const [method, ...pathParts] = entry.split(" ");
    getOperation(spec, method, pathParts.join(" "));
  }

  const requiredSchemas = [
    "AutomationCommandListResponse",
    "AutomationTaskListResponse",
    "AutomationTaskResponse",
    "AutomationRunRequest",
    "AutomationRunResponse",
    "AutomationTask",
    "TemplateReadinessStep",
    "TemplateReadiness",
    "RunCreateRequest",
    "RunOtpSubmitRequest",
    "RunRecoveryAction",
    "RunRecoveryPlan",
    "RunRecoveryPlanResponse",
    "RunListResponse",
    "RunResponse",
    "RunCancelResponse",
    "Run",
    "RunStatus",
    "RunLogEntry",
    "EvidenceRegistryState",
    "EvidenceRetentionState",
    "EvidenceRunProvenance",
    "EvidenceRunSummary",
    "EvidenceRun",
    "EvidenceRunListResponse",
    "EvidenceRunResponse",
    "EvidenceRunLatestResponse",
    "EvidenceRunCompareGateStatusDelta",
    "EvidenceRunCompareSummaryDelta",
    "EvidenceRunCompareArtifactDelta",
    "EvidenceRunCompare",
    "EvidenceRunCompareResponse",
    "EvidenceSharePackJsonBundle",
    "EvidenceSharePack",
    "EvidenceSharePackResponse",
    "FailureExplanationAnchor",
    "FailureExplanation",
    "FailureExplanationResponse",
    "PromotionCandidate",
    "PromotionCandidateResponse",
    "ReportSummary",
    "ReportCheck",
    "DiagnosticsResponse",
    "DiagnosticsIndex"
  ];

  const schemaNames = Object.keys(spec.components?.schemas ?? {});
  for (const schema of requiredSchemas) {
    assert.ok(schemaNames.includes(schema), `Missing schema: ${schema}`);
  }

  assert.equal(
    getResponseSchemaRef(getOperation(spec, "GET", "/api/automation/commands"), "200"),
    "AutomationCommandListResponse"
  );
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/automation/tasks"), "200"), "AutomationTaskListResponse");
  assert.equal(getRequestSchemaRef(getOperation(spec, "POST", "/api/automation/run")), "AutomationRunRequest");
  assert.equal(getResponseSchemaRef(getOperation(spec, "POST", "/api/automation/run"), "200"), "AutomationRunResponse");
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/runs"), "200"), "RunListResponse");
  assert.equal(getRequestSchemaRef(getOperation(spec, "POST", "/api/runs")), "RunCreateRequest");
  assert.equal(getResponseSchemaRef(getOperation(spec, "POST", "/api/runs"), "200"), "RunResponse");
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/runs/{run_id}"), "200"), "RunResponse");
  assert.equal(getRequestSchemaRef(getOperation(spec, "POST", "/api/runs/{run_id}/otp")), "RunOtpSubmitRequest");
  assert.equal(getResponseSchemaRef(getOperation(spec, "POST", "/api/runs/{run_id}/otp"), "200"), "RunResponse");
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/runs/{run_id}/recover-plan"), "200"), "RunRecoveryPlanResponse");
  assert.equal(getResponseSchemaRef(getOperation(spec, "POST", "/api/runs/{run_id}/cancel"), "200"), "RunCancelResponse");
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/templates/{template_id}/readiness"), "200"), "TemplateReadiness");
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/evidence-runs"), "200"), "EvidenceRunListResponse");
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/evidence-runs/latest"), "200"), "EvidenceRunLatestResponse");
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/evidence-runs/{run_id}"), "200"), "EvidenceRunResponse");
  assert.equal(
    getResponseSchemaRef(getOperation(spec, "GET", "/api/evidence-runs/{run_id}/compare/{candidate_run_id}"), "200"),
    "EvidenceRunCompareResponse"
  );
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/evidence-runs/{run_id}/share-pack"), "200"), "EvidenceSharePackResponse");
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/evidence-runs/{run_id}/explain"), "200"), "FailureExplanationResponse");
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/api/evidence-runs/{run_id}/promotion-candidate"), "200"), "PromotionCandidateResponse");
  assert.equal(getResponseSchemaRef(getOperation(spec, "GET", "/health/diagnostics"), "200"), "DiagnosticsResponse");

  const diagnosticsSchema = getResponseSchema(spec, getOperation(spec, "GET", "/health/diagnostics"), "200");
  assert.ok(diagnosticsSchema, "DiagnosticsResponse schema must exist");
  assert.deepEqual((diagnosticsSchema!.required as string[]).sort(), ["metrics", "status", "storage_backend", "task_counts", "task_total", "uptime_seconds"]);

  const alertsSchema = getResponseSchema(spec, getOperation(spec, "GET", "/health/alerts"), "200");
  assert.ok(alertsSchema, "AlertsResponse schema must exist");
  assert.deepEqual((alertsSchema!.required as string[]).sort(), ["completed", "failed", "failure_rate", "state", "threshold"]);

  assert.deepEqual(getResponseMediaTypes(getOperation(spec, "GET", "/health/metrics"), "200"), ["text/plain"]);
  assert.deepEqual(getResponseMediaTypes(getOperation(spec, "GET", "/metrics"), "200"), ["text/plain"]);
});

test("operationId is unique and generated artifacts match OpenAPI operations", () => {
  const spec = loadSpec();
  const operations = getOperations(spec).sort((a, b) => a.operationId.localeCompare(b.operationId));

  const opIds = operations.map((op) => op.operationId);
  const uniqueOpIds = new Set(opIds);
  assert.equal(uniqueOpIds.size, opIds.length, "operationId must be unique across the API spec");

  const generatedClient = readFileSync(generatedClientPath, "utf8");
  const generatedAutomationApi = readFileSync(generatedAutomationApiPath, "utf8");
  const generatedHealthApi = readFileSync(generatedHealthApiPath, "utf8");
  const generatedCommandTowerApi = readFileSync(generatedCommandTowerApiPath, "utf8");
  const generatedMsw = readFileSync(generatedMswPath, "utf8");

  assert.match(generatedClient, /export const API_OPERATIONS = \[/);
  assert.match(generatedClient, /\.\.\.HEALTH_API_OPERATIONS/);
  assert.match(generatedClient, /\.\.\.AUTOMATION_API_OPERATIONS/);
  assert.match(generatedClient, /\.\.\.COMMAND_TOWER_API_OPERATIONS/);

  const generatedOperations = [
    ...parseGeneratedOperations(generatedHealthApi, "HEALTH_API_OPERATIONS"),
    ...parseGeneratedOperations(generatedAutomationApi, "AUTOMATION_API_OPERATIONS"),
    ...parseGeneratedOperations(generatedCommandTowerApi, "COMMAND_TOWER_API_OPERATIONS")
  ];
  const generatedSorted = generatedOperations.sort((a, b) => a.operationId.localeCompare(b.operationId));

  assert.deepEqual(
    generatedSorted.map((op) => ({ operationId: op.operationId, method: op.method, path: op.path })),
    operations
  );

  for (const op of operations) {
    assert.ok(generatedMsw.includes(`operationId: "${op.operationId}"`));
  }
});

test("generated client replaces path placeholders with function parameters", () => {
  const generatedAutomationApi = readFileSync(generatedAutomationApiPath, "utf8");

  const fetchUrlSegments = Array.from(generatedAutomationApi.matchAll(/requestJson\(baseUrl, `([^`]+)`/g), (match) => match[1]);
  for (const urlSegment of fetchUrlSegments) {
    const withoutTemplateExpressions = urlSegment.replace(/\$\{[^}]+\}/g, "");
    assert.ok(
      !/\{[a-zA-Z0-9_]+\}/.test(withoutTemplateExpressions),
      `generated fetch URL must not keep placeholders: ${urlSegment}`
    );
  }

  assert.match(generatedAutomationApi, /getAutomationTask\(baseUrl: string, pathParams: \{ task_id: string \}, init\?: RequestInit\)/);
  assert.match(generatedAutomationApi, /getRun\(baseUrl: string, pathParams: \{ run_id: string \}, init\?: RequestInit\)/);
  assert.match(generatedAutomationApi, /submitRunOtp\(baseUrl: string, pathParams: \{ run_id: string \}, init\?: RequestInit\)/);
  assert.match(generatedAutomationApi, /cancelRun\(baseUrl: string, pathParams: \{ run_id: string \}, init\?: RequestInit\)/);

  assert.match(generatedAutomationApi, /encodeURIComponent\(pathParams\.task_id\)/);
  assert.match(generatedAutomationApi, /encodeURIComponent\(pathParams\.run_id\)/);
});

test("generated client keeps required query params and text/plain parsing behavior", () => {
  const generatedCommandTowerApi = readFileSync(generatedCommandTowerApiPath, "utf8");
  const generatedHealthApi = readFileSync(generatedHealthApiPath, "utf8");
  const generatedRequestCore = readFileSync(resolve("apps/web/src/api-gen/core/request.ts"), "utf8");

  assert.match(
    generatedCommandTowerApi,
    /getCommandTowerStepEvidence\(baseUrl: string, queryParams: \{ step_id: string; session_id\?: string \}, init\?: RequestInit\)/,
  );
  assert.match(generatedCommandTowerApi, /searchParams\.append\("step_id", String\(queryParams\.step_id\)\)/);
  assert.match(generatedCommandTowerApi, /if \(queryParams\.session_id !== undefined\) \{/);
  assert.match(generatedCommandTowerApi, /searchParams\.append\("session_id", String\(queryParams\.session_id\)\)/);

  assert.match(generatedHealthApi, /return requestText\(baseUrl, path, "GET", init\);/);
  assert.match(generatedRequestCore, /export async function requestText\(/);
});

test("generated client keeps builder-facing entrypoints stable", () => {
  const generatedClient = readFileSync(generatedClientPath, "utf8");
  const generatedAutomationApi = readFileSync(generatedAutomationApiPath, "utf8");
  const generatedCommandTowerApi = readFileSync(generatedCommandTowerApiPath, "utf8");

  assert.match(generatedClient, /export \* from "\.\/api\/health";/);
  assert.match(generatedClient, /export \* from "\.\/api\/automation";/);
  assert.match(generatedClient, /export \* from "\.\/api\/command-tower";/);

  assert.match(generatedAutomationApi, /export async function listAutomationCommands\(/);
  assert.match(generatedAutomationApi, /export async function listEvidenceRuns\(/);
  assert.match(generatedCommandTowerApi, /export async function getCommandTowerOverview\(/);
});
