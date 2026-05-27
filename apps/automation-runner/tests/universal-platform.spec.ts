import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const REPO_RUNTIME_ROOT = path.join(REPO_ROOT, ".runtime-cache");

async function createSession(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/sessions/start", {
    data: { start_url: `https://${unique("session")}.example.com/register`, mode: "manual" },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { session_id: string };
  return body.session_id;
}

async function createFlow(request: APIRequestContext, sessionId: string): Promise<string> {
  const response = await request.post("/api/flows", {
    data: {
      session_id: sessionId,
      start_url: `https://${unique("flow")}.example.com/register`,
      steps: [{ step_id: "s1", action: "navigate", url: "https://example.com/register" }],
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { flow_id: string };
  return body.flow_id;
}

async function createReconstructionArtifacts(
  prefix: string,
  options: { harDoc?: object; html?: string }
): Promise<string> {
  const sessionDir = path.join(REPO_RUNTIME_ROOT, "automation", unique(prefix));
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(sessionDir, "register.har"),
    JSON.stringify(options.harDoc ?? { log: { entries: [] } }),
    "utf-8"
  );
  await writeFile(path.join(sessionDir, "page.html"), options.html ?? "<html><body>ok</body></html>", "utf-8");
  return sessionDir;
}

test("01 health endpoint is reachable", async ({ request }) => {
  const response = await request.get("/health/");
  expect(response.status()).toBe(200);
});

test("02 csrf endpoint returns token", async ({ request }) => {
  const response = await request.get("/api/csrf");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { csrf_token: string };
  expect(typeof body.csrf_token).toBe("string");
  expect(body.csrf_token.length).toBeGreaterThan(0);
});

test("03 register rejects when csrf missing", async ({ request }) => {
  const response = await request.post("/api/register", {
    data: { email: `${unique("missing-csrf")}@example.com`, password: "StrongPass1!" },
  });
  expect(response.status()).toBe(403);
});

test("04 register succeeds with csrf", async ({ request }) => {
  const csrf = await request.get("/api/csrf");
  const token = ((await csrf.json()) as { csrf_token: string }).csrf_token;
  const response = await request.post("/api/register", {
    data: { email: `${unique("register")}@example.com`, password: "StrongPass1!" },
    headers: { "X-CSRF-Token": token },
  });
  expect(response.status()).toBe(201);
});

test("05 session start supports manual mode", async ({ request }) => {
  const response = await request.post("/api/sessions/start", {
    data: { start_url: `https://${unique("manual")}.example.com`, mode: "manual" },
  });
  expect(response.ok()).toBe(true);
  expect(((await response.json()) as { mode: string }).mode).toBe("manual");
});

test("06 session start supports ai mode", async ({ request }) => {
  const response = await request.post("/api/sessions/start", {
    data: { start_url: `https://${unique("ai")}.example.com`, mode: "ai" },
  });
  expect(response.ok()).toBe(true);
  expect(((await response.json()) as { mode: string }).mode).toBe("ai");
});

test("07 sessions list returns data", async ({ request }) => {
  await createSession(request);
  const response = await request.get("/api/sessions?limit=10");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { sessions: unknown[] };
  expect(body.sessions.length).toBeGreaterThan(0);
});

test("08 create flow works", async ({ request }) => {
  const sessionId = await createSession(request);
  const flowId = await createFlow(request, sessionId);
  expect(flowId.length).toBeGreaterThan(0);
});

test("09 get flow works", async ({ request }) => {
  const sessionId = await createSession(request);
  const flowId = await createFlow(request, sessionId);
  const response = await request.get(`/api/flows/${flowId}`);
  expect(response.ok()).toBe(true);
  expect(((await response.json()) as { flow_id: string }).flow_id).toBe(flowId);
});

test("10 update flow start url", async ({ request }) => {
  const sessionId = await createSession(request);
  const flowId = await createFlow(request, sessionId);
  const response = await request.patch(`/api/flows/${flowId}`, {
    data: { start_url: "https://updated.example.com/register" },
  });
  expect(response.ok()).toBe(true);
  expect(((await response.json()) as { start_url: string }).start_url).toBe("https://updated.example.com/register");
});

test("11 create template strips secret defaults", async ({ request }) => {
  const sessionId = await createSession(request);
  const flowId = await createFlow(request, sessionId);
  const response = await request.post("/api/templates", {
    data: {
      flow_id: flowId,
      name: unique("template"),
      params_schema: [
        { key: "email", type: "email", required: true },
        { key: "password", type: "secret", required: true },
      ],
      defaults: { email: "a@example.com", password: "not-stored" },
      policies: { otp: { required: false, provider: "manual" } },
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { defaults: Record<string, string> };
  expect(body.defaults.password).toBeUndefined();
});

test("12 export template masks secret defaults", async ({ request }) => {
  const sessionId = await createSession(request);
  const flowId = await createFlow(request, sessionId);
  const template = await request.post("/api/templates", {
    data: {
      flow_id: flowId,
      name: unique("template-export"),
      params_schema: [{ key: "password", type: "secret", required: true }],
      defaults: { password: "not-stored" },
      policies: { otp: { required: false, provider: "manual" } },
    },
  });
  const templateId = ((await template.json()) as { template_id: string }).template_id;
  const exported = await request.get(`/api/templates/${templateId}/export`);
  expect(exported.ok()).toBe(true);
  const body = (await exported.json()) as { defaults: Record<string, string> };
  expect(body.defaults.password === undefined || body.defaults.password === "***").toBe(true);
});

test("13 create run returns queued", async ({ request }) => {
  const sessionId = await createSession(request);
  const flowId = await createFlow(request, sessionId);
  const template = await request.post("/api/templates", {
    data: {
      flow_id: flowId,
      name: unique("run-template"),
      params_schema: [{ key: "email", type: "email", required: true }],
      defaults: { email: "run@example.com" },
      policies: { otp: { required: false, provider: "manual" } },
    },
  });
  const templateId = ((await template.json()) as { template_id: string }).template_id;
  const run = await request.post("/api/runs", {
    data: { template_id: templateId, params: { email: `${unique("run")}@example.com` } },
  });
  expect(run.ok()).toBe(true);
  expect(["queued", "running"]).toContain(
    ((await run.json()) as { run: { status: string } }).run.status
  );
});

test("14 get run works", async ({ request }) => {
  const sessionId = await createSession(request);
  const flowId = await createFlow(request, sessionId);
  const template = await request.post("/api/templates", {
    data: {
      flow_id: flowId,
      name: unique("run-get-template"),
      params_schema: [],
      defaults: {},
      policies: { otp: { required: false, provider: "manual" } },
    },
  });
  const templateId = ((await template.json()) as { template_id: string }).template_id;
  const run = await request.post("/api/runs", { data: { template_id: templateId, params: {} } });
  const runId = ((await run.json()) as { run: { run_id: string } }).run.run_id;
  const loaded = await request.get(`/api/runs/${runId}`);
  expect(loaded.ok()).toBe(true);
  expect(((await loaded.json()) as { run: { run_id: string } }).run.run_id).toBe(runId);
});

test("15 cancel run switches status", async ({ request }) => {
  const sessionId = await createSession(request);
  const flowId = await createFlow(request, sessionId);
  const template = await request.post("/api/templates", {
    data: {
      flow_id: flowId,
      name: unique("run-cancel-template"),
      params_schema: [],
      defaults: {},
      policies: { otp: { required: false, provider: "manual" } },
    },
  });
  const templateId = ((await template.json()) as { template_id: string }).template_id;
  const run = await request.post("/api/runs", { data: { template_id: templateId, params: {} } });
  const runId = ((await run.json()) as { run: { run_id: string } }).run.run_id;
  const cancel = await request.post(`/api/runs/${runId}/cancel`);
  expect(cancel.ok()).toBe(true);
  expect(((await cancel.json()) as { run: { status: string } }).run.status).toBe("cancelled");
});

test("16 otp-required run waits for otp", async ({ request }) => {
  const sessionId = await createSession(request);
  const flowId = await createFlow(request, sessionId);
  const template = await request.post("/api/templates", {
    data: {
      flow_id: flowId,
      name: unique("run-otp-template"),
      params_schema: [{ key: "otp", type: "secret", required: true }],
      defaults: {},
      policies: { otp: { required: true, provider: "manual" } },
    },
  });
  const templateId = ((await template.json()) as { template_id: string }).template_id;
  const run = await request.post("/api/runs", { data: { template_id: templateId, params: {} } });
  expect(run.ok()).toBe(true);
  expect(((await run.json()) as { run: { status: string } }).run.status).toBe("waiting_otp");
});

test("17 otp submit resumes waiting run", async ({ request }) => {
  const sessionId = await createSession(request);
  const flowId = await createFlow(request, sessionId);
  const template = await request.post("/api/templates", {
    data: {
      flow_id: flowId,
      name: unique("run-otp-resume-template"),
      params_schema: [{ key: "otp", type: "secret", required: true }],
      defaults: {},
      policies: { otp: { required: true, provider: "manual" } },
    },
  });
  const templateId = ((await template.json()) as { template_id: string }).template_id;
  const run = await request.post("/api/runs", { data: { template_id: templateId, params: {} } });
  const runId = ((await run.json()) as { run: { run_id: string } }).run.run_id;
  const resumed = await request.post(`/api/runs/${runId}/otp`, { data: { otp_code: "123456" } });
  expect(resumed.ok()).toBe(true);
  expect(["queued", "running"]).toContain(
    ((await resumed.json()) as { run: { status: string } }).run.status
  );
});

test("18 profile resolve supports inline artifacts", async ({ request }) => {
  const harDoc = {
    log: {
      entries: [
        {
          startedDateTime: "2026-02-18T00:00:00.000Z",
          request: { method: "GET", url: "https://example.com/register" },
          response: { status: 200 },
        },
        {
          startedDateTime: "2026-02-18T00:00:01.000Z",
          request: {
            method: "POST",
            url: "https://example.com/api/register",
            headers: [{ name: "X-CSRF-Token", value: "masked" }],
            postData: { mimeType: "application/json", text: JSON.stringify({ email: "a@b.c", password: "pw" }) },
          },
          response: { status: 200 },
        },
      ],
    },
  };
  const sessionDir = await createReconstructionArtifacts("profile", {
    harDoc,
    html: "<html><body>captcha challenge</body></html>",
  });
  const response = await request.post("/api/profiles/resolve", {
    data: {
      artifacts: { session_dir: sessionDir },
      extractor_strategy: "balanced",
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { profile: string; har_alignment_score: number };
  expect(body.profile).toBe("api-centric");
  expect(body.har_alignment_score).toBeGreaterThan(0);
});

test("19 command tower overview is available", async ({ request }) => {
  const response = await request.get("/api/command-tower/overview");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { status: string };
  expect(body.status).toBe("ok");
});

test("20 command tower orchestrate exposes risk fields", async ({ request }) => {
  const sessionDir = await createReconstructionArtifacts("orchestrate", {
    harDoc: {
      log: {
        entries: [
          {
            request: {
              method: "POST",
              url: "https://inline.example.com/api/register",
            },
            response: { status: 200 },
          },
        ],
      },
    },
    html: "<html><body>ok</body></html>",
  });
  const response = await request.post("/api/command-tower/orchestrate-from-artifacts", {
    data: {
      artifacts: { session_dir: sessionDir },
      extractor_strategy: "balanced",
      template_name: unique("template"),
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    manual_handoff_required: boolean;
    template_id: string;
    generator_outputs: Record<string, string>;
  };
  expect(body.template_id.startsWith("tp_")).toBe(true);
  expect(typeof body.manual_handoff_required).toBe("boolean");
  expect(typeof body.generator_outputs.readiness_report).toBe("string");
});
