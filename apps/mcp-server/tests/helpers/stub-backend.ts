// @ts-nocheck
import http from "node:http"

export type StubBackend = {
  baseUrl: string
  getStats: () => {
    otpSubmitCount: number
    receivedOtpCodes: string[]
    runGetCount: number
  }
  close: () => Promise<void>
}

export async function startStubBackend(options?: {
  requireToken?: boolean
  acceptedToken?: string
  commandsStatus?: number
  delayMs?: number
  runStatusSequence?: string[]
  otpSuccessStatus?: string
  importLatestFlowPayload?: Record<string, unknown>
}): Promise<StubBackend> {
  const requireToken = options?.requireToken ?? false
  const acceptedToken = options?.acceptedToken ?? "token-1"
  const commandsStatus = options?.commandsStatus ?? 200
  const delayMs = options?.delayMs ?? 0
  const runStatusSequence = options?.runStatusSequence ?? ["success"]
  const otpSuccessStatus = options?.otpSuccessStatus ?? "success"
  const importLatestFlowPayload = options?.importLatestFlowPayload ?? { flow_id: "flow-1" }
  let runStatusIndex = 0
  let otpSubmitCount = 0
  let runGetCount = 0
  const receivedOtpCodes: string[] = []

  const currentRunStatus = (): string =>
    runStatusSequence[Math.min(runStatusIndex, runStatusSequence.length - 1)] ?? "success"

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    const token = req.headers["x-automation-token"]

    const reject401 = () => {
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ detail: "invalid automation token" }))
    }

    if (requireToken && token !== acceptedToken) {
      reject401()
      return
    }

    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs))
    }

    const writeJson = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(payload))
    }

    const readJsonBody = async (): Promise<Record<string, unknown>> => {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      if (chunks.length === 0) return {}
      const text = Buffer.concat(chunks).toString("utf8").trim()
      if (!text) return {}
      return JSON.parse(text) as Record<string, unknown>
    }

    if (req.method === "GET" && url.pathname === "/health/") {
      writeJson(200, { status: "ok" })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/automation/commands") {
      if (commandsStatus !== 200) {
        writeJson(commandsStatus, { detail: "backend failure" })
        return
      }
      writeJson(200, {
        commands: [{ command_id: "run", title: "Run", description: "fixture", tags: [] }],
      })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/automation/tasks") {
      writeJson(200, { tasks: [] })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      writeJson(200, { sessions: [{ session_id: "session-1", status: "active" }] })
      return
    }

    if (req.method === "POST" && /^\/api\/sessions\/[^/]+\/finish$/.test(url.pathname)) {
      const sessionId = decodeURIComponent(url.pathname.split("/")[3] ?? "session-1")
      writeJson(200, { session_id: sessionId, status: "finished" })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/flows") {
      writeJson(200, { items: [] })
      return
    }

    if (req.method === "POST" && url.pathname === "/api/flows/import-latest") {
      writeJson(200, importLatestFlowPayload)
      return
    }

    if (req.method === "GET" && /^\/api\/flows\/[^/]+$/.test(url.pathname)) {
      const flowId = decodeURIComponent(url.pathname.split("/")[3] ?? "flow-1")
      writeJson(200, { flow_id: flowId, status: "ready" })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/templates") {
      writeJson(200, { items: [] })
      return
    }

    if (req.method === "POST" && url.pathname === "/api/templates") {
      const body = await readJsonBody()
      writeJson(200, { template_id: "tpl-1", ...body })
      return
    }

    if (req.method === "GET" && /^\/api\/templates\/[^/]+$/.test(url.pathname)) {
      const templateId = decodeURIComponent(url.pathname.split("/")[3] ?? "tpl-1")
      writeJson(200, { template_id: templateId, status: "ready" })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/runs") {
      writeJson(200, { items: [] })
      return
    }

    if (req.method === "POST" && url.pathname === "/api/runs") {
      writeJson(200, { run_id: "run-1", status: currentRunStatus() })
      return
    }

    if (req.method === "GET" && /^\/api\/runs\/[^/]+$/.test(url.pathname)) {
      runGetCount += 1
      const runId = decodeURIComponent(url.pathname.split("/")[3] ?? "run-1")
      const status = currentRunStatus()
      if (runStatusIndex < runStatusSequence.length - 1) runStatusIndex += 1
      writeJson(200, { run_id: runId, status })
      return
    }

    if (req.method === "POST" && /^\/api\/runs\/[^/]+\/otp$/.test(url.pathname)) {
      const body = await readJsonBody()
      otpSubmitCount += 1
      const runId = decodeURIComponent(url.pathname.split("/")[3] ?? "run-1")
      if (typeof body.otp_code === "string") {
        receivedOtpCodes.push(body.otp_code)
      }
      runStatusIndex = runStatusSequence.indexOf(otpSuccessStatus)
      if (runStatusIndex < 0) runStatusIndex = runStatusSequence.length - 1
      writeJson(200, { run_id: runId, status: otpSuccessStatus })
      return
    }

    if (req.method === "POST" && url.pathname === "/api/sessions/start") {
      const body = await readJsonBody()
      writeJson(200, {
        session_id: "session-1",
        start_url: typeof body.start_url === "string" ? body.start_url : null,
        mode: typeof body.mode === "string" ? body.mode : null,
      })
      return
    }

    writeJson(404, { detail: "not found" })
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("stub backend address unavailable")

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    getStats: () => ({
      otpSubmitCount,
      receivedOtpCodes: [...receivedOtpCodes],
      runGetCount,
    }),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },
  }
}
