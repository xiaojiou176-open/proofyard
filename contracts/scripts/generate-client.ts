import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";

const openapiPath = resolve("contracts/openapi/api.yaml");
const clientOutputDir = resolve("apps/web/src/api-gen");
const apiOutputDir = resolve(clientOutputDir, "api");
const coreOutputDir = resolve(clientOutputDir, "core");
const mswOutputDir = resolve("apps/web/msw");

const requestOutputFile = resolve(coreOutputDir, "request.ts");
const healthOutputFile = resolve(apiOutputDir, "health.ts");
const automationOutputFile = resolve(apiOutputDir, "automation.ts");
const commandTowerOutputFile = resolve(apiOutputDir, "command-tower.ts");
const clientOutputFile = resolve(clientOutputDir, "client.ts");
const mswOutputFile = resolve(mswOutputDir, "handlers.ts");
const verifyMode = process.argv.includes("--verify");

type OpenApiSpec = {
  paths?: Record<
    string,
    Record<string, { operationId?: string; responses?: Record<string, unknown>; parameters?: unknown[] }> & {
      parameters?: unknown[];
    }
  >;
  components?: {
    parameters?: Record<
      string,
      {
        in?: string;
        name?: string;
        required?: boolean;
        schema?: { type?: string };
      }
    >;
  };
};

type OpenApiOperation = {
  operationId?: string;
  responses?: Record<string, unknown>;
  parameters?: unknown[];
};

type Operation = {
  path: string;
  method: string;
  operationId: string;
  queryParams: QueryParam[];
  responseKind: "json" | "text";
};

type PathParam = {
  raw: string;
  name: string;
};

type QueryParam = {
  raw: string;
  name: string;
  required: boolean;
  type: "string" | "number" | "boolean";
};

type ApiModuleName = "health" | "automation" | "command-tower";

function toPascalCase(value: string): string {
  return value
    .replace(/[{}]/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join("");
}

function buildOperationId(method: string, path: string): string {
  return `${method.toLowerCase()}${toPascalCase(path)}`.replace(/[^a-zA-Z0-9_]/g, "");
}

function resolveResponseKind(operation: { responses?: Record<string, unknown> }): "json" | "text" {
  const responses = operation.responses ?? {};
  for (const statusCode of ["200", "201", "202", "203", "204", "default"]) {
    const response = responses[statusCode];
    if (!response || typeof response !== "object") continue;
    const content = (response as { content?: Record<string, unknown> }).content;
    if (!content || typeof content !== "object") continue;
    if ("text/plain" in content) {
      return "text";
    }
    if ("application/json" in content) {
      return "json";
    }
  }
  return "json";
}

function dereferenceParameter(
  spec: OpenApiSpec,
  parameter: unknown
):
  | {
      in?: string;
      name?: string;
      required?: boolean;
      schema?: { type?: string };
    }
  | null {
  if (!parameter || typeof parameter !== "object") return null;
  if ("$ref" in parameter) {
    const ref = (parameter as { $ref?: unknown }).$ref;
    if (typeof ref !== "string") return null;
    const match = ref.match(/^#\/components\/parameters\/(.+)$/);
    if (!match) return null;
    const resolved = spec.components?.parameters?.[match[1]];
    return resolved ?? null;
  }
  return parameter as {
    in?: string;
    name?: string;
    required?: boolean;
    schema?: { type?: string };
  };
}

function toQueryParamType(rawType: unknown): "string" | "number" | "boolean" {
  if (rawType === "number" || rawType === "integer") return "number";
  if (rawType === "boolean") return "boolean";
  return "string";
}

function isOpenApiOperation(value: unknown): value is OpenApiOperation {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractQueryParams(spec: OpenApiSpec, parameters: unknown[]): QueryParam[] {
  const queryParams: QueryParam[] = [];
  for (const parameter of parameters) {
    const resolved = dereferenceParameter(spec, parameter);
    if (!resolved || resolved.in !== "query") continue;
    const rawName = typeof resolved.name === "string" ? resolved.name : "";
    const safeName = rawName.replace(/[^a-zA-Z0-9_$]/g, "_");
    if (!safeName) continue;
    queryParams.push({
      raw: rawName,
      name: safeName,
      required: resolved.required === true,
      type: toQueryParamType(resolved.schema?.type),
    });
  }
  return queryParams;
}

function extractOperations(spec: OpenApiSpec): Operation[] {
  const ops: Operation[] = [];
  const supportedMethods = new Set(["get", "post", "put", "patch", "delete"]);
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    const pathParameters = Array.isArray(methods.parameters) ? methods.parameters : [];
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (!supportedMethods.has(method.toLowerCase())) continue;
      if (!isOpenApiOperation(operation)) continue;
      const operationId = operation.operationId?.trim() || buildOperationId(method, path);
      const operationParameters = Array.isArray(operation.parameters) ? operation.parameters : [];
      ops.push({
        path,
        method: method.toUpperCase(),
        operationId,
        queryParams: extractQueryParams(spec, [...pathParameters, ...operationParameters]),
        responseKind: resolveResponseKind(operation),
      });
    }
  }
  return ops;
}

function extractPathParams(path: string): PathParam[] {
  const matches = path.matchAll(/\{([^}]+)\}/g);
  return Array.from(matches, (match) => {
    const raw = match[1];
    return {
      raw,
      name: raw.replace(/[^a-zA-Z0-9_$]/g, "_")
    };
  });
}

function buildResolvedPath(path: string, pathParams: PathParam[]): string {
  return pathParams.reduce((resolved, param) => {
    return resolved.replaceAll(`{${param.raw}}`, `\${encodeURIComponent(pathParams.${param.name})}`);
  }, path);
}

function resolveApiModule(path: string): ApiModuleName {
  if (path === "/" || path === "/metrics" || path.startsWith("/health/")) {
    return "health";
  }
  if (path.startsWith("/api/command-tower/")) {
    return "command-tower";
  }
  return "automation";
}

function groupOperationsByModule(operations: Operation[]): Record<ApiModuleName, Operation[]> {
  const grouped: Record<ApiModuleName, Operation[]> = {
    health: [],
    automation: [],
    "command-tower": []
  };
  for (const operation of operations) {
    grouped[resolveApiModule(operation.path)].push(operation);
  }
  return grouped;
}

function buildRequestCore(): string {
  return [
    "// Auto-generated by contracts/scripts/generate-client.ts. Do not edit manually.",
    "",
    "export async function requestJson(baseUrl: string, path: string, method: string, init?: RequestInit): Promise<unknown> {",
    "  const response = await fetch(`${baseUrl}${path}`, {",
    "    method,",
    "    headers: {",
    "      \"content-type\": \"application/json\",",
    "      ...(init?.headers ?? {})",
    "    },",
    "    ...init",
    "  });",
    "  const text = await response.text();",
    "  if (!response.ok) {",
    "    throw new Error(`API request failed: ${response.status} ${response.statusText}`);",
    "  }",
    "  if (text.length === 0) {",
    "    return undefined;",
    "  }",
    "  try {",
    "    return JSON.parse(text);",
    "  } catch {",
    "    throw new Error(`API request expected JSON body but received non-JSON payload for ${method} ${path}`);",
    "  }",
    "}",
    "",
    "export async function requestText(baseUrl: string, path: string, method: string, init?: RequestInit): Promise<string> {",
    "  const response = await fetch(`${baseUrl}${path}`, {",
    "    method,",
    "    ...init",
    "  });",
    "  const text = await response.text();",
    "  if (!response.ok) {",
    "    throw new Error(`API request failed: ${response.status} ${response.statusText}`);",
    "  }",
    "  return text;",
    "}",
    ""
  ].join("\n");
}

function buildApiModule(operations: Operation[], operationsConstName: string): string {
  const needsTextRequest = operations.some((operation) => operation.responseKind === "text");
  const requestImport = needsTextRequest ? 'import { requestJson, requestText } from "../core/request";' : 'import { requestJson } from "../core/request";';
  const methods = operations.map((op) => {
    const pathParams = extractPathParams(op.path);
    const pathParamsType =
      pathParams.length > 0
        ? `{ ${pathParams.map((param) => `${param.name}: string`).join("; ")} }`
        : null;
    const queryParamsType =
      op.queryParams.length > 0
        ? `{ ${op.queryParams.map((param) => `${param.name}${param.required ? "" : "?"}: ${param.type}`).join("; ")} }`
        : null;
    const resolvedPath = buildResolvedPath(op.path, pathParams);
    const args = ["baseUrl: string"];
    if (pathParamsType) {
      args.push(`pathParams: ${pathParamsType}`);
    }
    if (queryParamsType) {
      args.push(`queryParams: ${queryParamsType}`);
    }
    args.push("init?: RequestInit");
    const requestFunctionName = op.responseKind === "text" ? "requestText" : "requestJson";
    const urlBuilderLines =
      op.queryParams.length === 0
        ? [`  const path = \`${resolvedPath}\`;`]
        : [
            "  const searchParams = new URLSearchParams();",
            ...op.queryParams.map((param) => {
              if (param.required) {
                return `  searchParams.append("${param.raw}", String(queryParams.${param.name}));`;
              }
              return [
                `  if (queryParams.${param.name} !== undefined) {`,
                `    searchParams.append("${param.raw}", String(queryParams.${param.name}));`,
                "  }",
              ].join("\n");
            }),
            `  const path = searchParams.size > 0 ? \`${resolvedPath}?\${searchParams.toString()}\` : \`${resolvedPath}\`;`,
          ];

    return [
      `export async function ${op.operationId}(${args.join(", ")}): Promise<unknown> {`,
      ...urlBuilderLines,
      `  return ${requestFunctionName}(baseUrl, path, "${op.method}", init);`,
      "}"
    ].join("\n");
  });

  const operationsConst =
    operations.length > 0
      ? `export const ${operationsConstName} = ${JSON.stringify(
          operations.map((op) => ({ operationId: op.operationId, method: op.method, path: op.path })),
          null,
          2
        )} as const;`
      : `export const ${operationsConstName} = [] as const;`;

  return [
    "// Auto-generated by contracts/scripts/generate-client.ts. Do not edit manually.",
    requestImport,
    "",
    ...methods,
    "",
    operationsConst,
    ""
  ].join("\n\n");
}

function buildClientCompat(): string {
  return [
    "// Auto-generated by contracts/scripts/generate-client.ts. Do not edit manually.",
    'import { HEALTH_API_OPERATIONS } from "./api/health";',
    'import { AUTOMATION_API_OPERATIONS } from "./api/automation";',
    'import { COMMAND_TOWER_API_OPERATIONS } from "./api/command-tower";',
    "",
    'export * from "./api/health";',
    'export * from "./api/automation";',
    'export * from "./api/command-tower";',
    "",
    "export const API_OPERATIONS = [",
    "  ...HEALTH_API_OPERATIONS,",
    "  ...AUTOMATION_API_OPERATIONS,",
    "  ...COMMAND_TOWER_API_OPERATIONS",
    "] as const;",
    ""
  ].join("\n");
}

function buildMswHandlers(operations: Operation[]): string {
  const handlers = operations
    .map((op) => {
      return [
        "  http." + op.method.toLowerCase() + `(\"${op.path}\", async () => {`,
        "    return HttpResponse.json({",
        `      operationId: \"${op.operationId}\",`,
        "      mocked: true",
        "    });",
        "  })"
      ].join("\n");
    })
    .join(",\n\n");

  return [
    "// Auto-generated by contracts/scripts/generate-client.ts. Do not edit manually.",
    'import { http, HttpResponse } from "msw";',
    "",
    "export const handlers = [",
    handlers,
    "];",
    ""
  ].join("\n");
}

function readOptionalFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const raw = readFileSync(openapiPath, "utf8");
const spec = YAML.parse(raw) as OpenApiSpec;
const operations = extractOperations(spec);
const groupedOperations = groupOperationsByModule(operations);

const generatedArtifacts = new Map<string, string>([
  [requestOutputFile, buildRequestCore()],
  [healthOutputFile, buildApiModule(groupedOperations.health, "HEALTH_API_OPERATIONS")],
  [automationOutputFile, buildApiModule(groupedOperations.automation, "AUTOMATION_API_OPERATIONS")],
  [commandTowerOutputFile, buildApiModule(groupedOperations["command-tower"], "COMMAND_TOWER_API_OPERATIONS")],
  [clientOutputFile, buildClientCompat()],
  [mswOutputFile, buildMswHandlers(operations)]
]);

if (verifyMode) {
  const driftedFiles: string[] = [];
  for (const [file, content] of generatedArtifacts) {
    if (readOptionalFile(file) !== content) {
      driftedFiles.push(file);
    }
  }

  if (driftedFiles.length > 0) {
    console.error("Contract verify failed. Generated artifacts are out of date:");
    for (const file of driftedFiles) {
      console.error(`- ${file}`);
    }
    console.error("Run `pnpm contracts:generate` and commit the updated artifacts.");
    process.exit(1);
  }

  console.log("Contract verify passed. Generated artifacts are up to date.");
  process.exit(0);
}

mkdirSync(coreOutputDir, { recursive: true });
mkdirSync(apiOutputDir, { recursive: true });
mkdirSync(mswOutputDir, { recursive: true });

for (const [file, content] of generatedArtifacts) {
  writeFileSync(file, content, "utf8");
  console.log(`Generated ${file}`);
}
