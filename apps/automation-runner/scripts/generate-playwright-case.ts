import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

type RegisterSpec = {
  baseUrl: string
  registerEndpoint: {
    method: string
    path: string
    contentType: string | null
  }
  csrfBootstrap: {
    exists: boolean
    path: string | null
  }
  payloadExample: Record<string, unknown>
}

const RUNTIME_ROOT = path.resolve(process.cwd(), "..", "..", ".runtime-cache", "automation")

function latestSpecPath(): string {
  return process.env.UIQ_AUTOMATION_LATEST_SPEC_PATH
    ? path.resolve(process.cwd(), process.env.UIQ_AUTOMATION_LATEST_SPEC_PATH)
    : path.join(RUNTIME_ROOT, "latest-spec.json")
}

function getOption(name: string): string | null {
  const prefix = `--${name}=`
  const matched = process.argv.find((arg) => arg.startsWith(prefix))
  return matched ? matched.slice(prefix.length) : null
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8")
  return JSON.parse(raw) as T
}

async function resolveSpecPath(): Promise<string> {
  const argSpec = getOption("spec")
  if (argSpec) {
    return path.resolve(process.cwd(), argSpec)
  }
  const latest = await readJson<{ specPath: string }>(latestSpecPath())
  return latest.specPath
}

function toLiteral(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function sanitizePayloadExample(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { ...payload }
  if (typeof sanitized.email === "string") {
    sanitized.email = "template@example.com"
  }
  if (typeof sanitized.password === "string") {
    sanitized.password = "***"
  }
  return sanitized
}

function buildTemplate(specPathLabel: string, spec: RegisterSpec): string {
  const csrfPath =
    spec.csrfBootstrap?.exists && spec.csrfBootstrap.path ? spec.csrfBootstrap.path : "/api/csrf"
  const payloadLiteral = toLiteral(sanitizePayloadExample(spec.payloadExample || {}))

  return `import { expect, request as playwrightRequest, test } from "@playwright/test";
import { startMockRegisterApiServer } from "../support/mock-register-api";

// env-waiver: process_env_template reason=generated_template_env scope=generated-template
const SPEC_PATH = process.env.SPEC_PATH ?? ${JSON.stringify(specPathLabel)};
const CSRF_PATH = ${JSON.stringify(csrfPath)};
const REGISTER_PATH = ${JSON.stringify(spec.registerEndpoint.path)};
const CONTENT_TYPE = ${JSON.stringify(spec.registerEndpoint.contentType ?? "application/json")};
const PAYLOAD_EXAMPLE = ${payloadLiteral} as Record<string, unknown>;
const GENERATED_VALUE = "Aa1!" + Date.now().toString(36) + "Z";

function resolveRegisterValue(): string {
  const exampleValue = PAYLOAD_EXAMPLE.password;
  if (typeof exampleValue === "string" && exampleValue.length >= 8 && exampleValue !== "***") {
    return exampleValue;
  }
  // env-waiver: process_env_template reason=generated_template_env scope=generated-template
  return String(process.env.REGISTER_PASSWORD ?? GENERATED_VALUE);
}

test("register from HAR generated template", async () => {
  const mockServer = await startMockRegisterApiServer({
    csrfPath: CSRF_PATH,
    registerPath: REGISTER_PATH,
  });
  const requestContext = await playwrightRequest.newContext({ baseURL: mockServer.baseUrl });

  try {
    const csrfResponse = await requestContext.get(CSRF_PATH, {
      headers: { Accept: "application/json" },
    });
    expect(csrfResponse.ok(), "csrf bootstrap failed using " + SPEC_PATH).toBeTruthy();
    const csrfJson = (await csrfResponse.json()) as { csrf_token?: string };
    expect(csrfJson.csrf_token).toBeTruthy();

    const payload = {
      ...PAYLOAD_EXAMPLE,
      email: "generated+" + Date.now() + "@example.com",
      password: resolveRegisterValue(),
    };

    const registerResponse = await requestContext.post(REGISTER_PATH, {
      data: payload,
      headers: {
        "X-CSRF-Token": String(csrfJson.csrf_token),
        "Content-Type": CONTENT_TYPE,
      },
    });

    expect(registerResponse.status()).toBe(201);
    const body = (await registerResponse.json()) as { user_id?: string; email?: string };
    expect(body.user_id).toBeTruthy();
    expect(body.email).toContain("@example.com");
  } finally {
    await requestContext.dispose();
    await mockServer.close();
  }
});
`
}

async function main(): Promise<void> {
  const specPath = await resolveSpecPath()
  const spec = await readJson<RegisterSpec>(specPath)
  const specPathLabel = path.relative(process.cwd(), specPath) || specPath

  const outArg = getOption("out")
  const outputPath = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.resolve(process.cwd(), "tests", "generated", "register-from-har.generated.spec.ts")

  await mkdir(path.dirname(outputPath), { recursive: true })
  const content = buildTemplate(specPathLabel, spec)
  await writeFile(outputPath, content, "utf-8")

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        specPath,
        outputPath,
      },
      null,
      2
    )}\n`
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`generate-playwright-case failed: ${message}\n`)
  process.exitCode = 1
})
