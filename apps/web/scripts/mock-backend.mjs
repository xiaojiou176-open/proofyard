import http from "node:http"

const host = "127.0.0.1"
const port = Number(process.env.UI_AUDIT_BACKEND_PORT || 17380)

const command = {
  command_id: "run",
  title: "Full flow (manual)",
  description: "Full pipeline: record/extract/generate/replay",
  tags: ["pipeline", "full"],
  accepts_env: true,
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(payload))
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${host}:${port}`)
  const path = requestUrl.pathname

  if (req.method === "GET" && path === "/api/automation/commands") {
    writeJson(res, 200, { commands: [command] })
    return
  }
  if (req.method === "GET" && path === "/health/") {
    writeJson(res, 200, { status: "ok" })
    return
  }
  if (req.method === "GET" && path === "/api/automation/tasks") {
    writeJson(res, 200, { tasks: [] })
    return
  }
  if (req.method === "GET" && path === "/api/command-tower/latest-flow") {
    writeJson(res, 200, {
      session_id: null,
      start_url: null,
      generated_at: null,
      source_event_count: 0,
      step_count: 0,
      steps: [],
    })
    return
  }
  if (req.method === "GET" && path === "/api/command-tower/latest-flow-draft") {
    writeJson(res, 200, { session_id: null, flow: null })
    return
  }
  if (req.method === "GET" && path === "/api/command-tower/evidence-timeline") {
    writeJson(res, 200, { items: [] })
    return
  }
  if (req.method === "GET" && path === "/api/flows") {
    writeJson(res, 200, { flows: [] })
    return
  }
  if (req.method === "GET" && path === "/api/templates") {
    writeJson(res, 200, { templates: [] })
    return
  }
  if (req.method === "GET" && path === "/api/runs") {
    writeJson(res, 200, { runs: [] })
    return
  }
  if (req.method === "GET" && path === "/health/diagnostics") {
    writeJson(res, 200, {
      status: "ok",
      uptime_seconds: 1,
      task_counts: { queued: 0, running: 0, success: 0, failed: 0, cancelled: 0 },
      task_total: 0,
      metrics: {
        requests_total: 1,
        request_status: { "2xx": 1 },
        automation_runs: 0,
        automation_failures: 0,
        automation_cancellations: 0,
        rate_limited: 0,
      },
    })
    return
  }
  if (req.method === "GET" && path === "/health/alerts") {
    writeJson(res, 200, { state: "ok", failure_rate: 0, threshold: 0.2, completed: 0, failed: 0 })
    return
  }
  if (req.method === "POST" && path === "/api/automation/run") {
    writeJson(res, 200, {
      task: {
        task_id: "ui-audit-task",
        command_id: "run",
        status: "queued",
        requested_by: "ui-audit",
        attempt: 1,
        max_attempts: 1,
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
        exit_code: null,
        message: "queued by ui audit mock backend",
        output_tail: "",
      },
    })
    return
  }
  if (
    req.method === "POST" &&
    path.startsWith("/api/automation/tasks/") &&
    path.endsWith("/cancel")
  ) {
    writeJson(res, 200, {
      task_id: "ui-audit-task",
      command_id: "run",
      status: "cancelled",
      requested_by: "ui-audit",
      attempt: 1,
      max_attempts: 1,
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: new Date().toISOString(),
      exit_code: null,
      message: "cancelled",
      output_tail: "",
    })
    return
  }

  writeJson(res, 404, { detail: "not found" })
})

server.listen(port, host, () => {
  process.stdout.write(`[ui-audit-mock] listening on http://${host}:${port}\n`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
