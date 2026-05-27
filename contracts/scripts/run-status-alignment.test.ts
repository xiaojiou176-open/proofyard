import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import YAML from "yaml";

function extractQuotedStrings(input: string): string[] {
  return Array.from(input.matchAll(/"([^"]+)"/g), (match) => match[1]);
}

test("acceptance ApiRunStatus stays aligned with OpenAPI RunStatus enum", () => {
  const spec = YAML.parse(readFileSync(resolve("contracts/openapi/api.yaml"), "utf8")) as {
    components?: { schemas?: { RunStatus?: { enum?: string[] } } };
  };
  const openapiRunStatus = spec.components?.schemas?.RunStatus?.enum ?? [];
  assert.ok(openapiRunStatus.length > 0, "OpenAPI RunStatus enum must exist");

  const acceptanceTypes = readFileSync(resolve("scripts/acceptance/lib/types.ts"), "utf8");
  const statusBlockMatch = acceptanceTypes.match(
    /export type ApiRunStatus =([\s\S]*?)\n\s*export type RunnerOutcome =/,
  );
  assert.ok(statusBlockMatch, "ApiRunStatus union must exist");
  const acceptanceStatuses = extractQuotedStrings(statusBlockMatch[1]);

  for (const status of openapiRunStatus) {
    assert.ok(
      acceptanceStatuses.includes(status),
      `scripts/acceptance/lib/types.ts ApiRunStatus must include OpenAPI status: ${status}`,
    );
  }

  const internalOnlyStatuses = acceptanceStatuses.filter((status) => !openapiRunStatus.includes(status));
  assert.deepEqual(
    [...internalOnlyStatuses].sort(),
    ["blocked"],
    "acceptance ApiRunStatus may only extend OpenAPI RunStatus with the internal 'blocked' state",
  );

  for (const pseudo of ["timeout", "api_error", "paused"]) {
    assert.ok(!acceptanceStatuses.includes(pseudo), `ApiRunStatus must not include pseudo status: ${pseudo}`);
  }
});

test("acceptance records expose runner outcome and reason code outside API status", () => {
  const acceptanceTypes = readFileSync(resolve("scripts/acceptance/lib/types.ts"), "utf8");
  assert.match(acceptanceTypes, /export type RunnerOutcome =/);
  assert.match(acceptanceTypes, /runnerOutcome:\s*RunnerOutcome\b/);
  assert.match(acceptanceTypes, /reasonCode\?:\s*string\b/);
});
