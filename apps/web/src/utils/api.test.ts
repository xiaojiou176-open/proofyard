import { describe, expect, it } from "vitest"
import { formatApiError, readErrorDetail } from "./api"

describe("api utils", () => {
  it("formats api error with request id", function () {
    const message = formatApiError("加载失败", {
      status: 403,
      detail: "denied",
      requestId: "req_1",
    })
    expect(message).toContain("HTTP 403")
    expect(message).toContain("request_id=req_1")
  })

  it("reads error detail from response json payload", async function () {
    const response = new Response(JSON.stringify({ detail: "bad request" }), {
      status: 400,
      headers: { "x-request-id": "req_2", "content-type": "application/json" },
    })
    const detail = await readErrorDetail(response)
    expect(detail.status).toBe(400)
    expect(detail.detail).toBe("bad request")
    expect(detail.requestId).toBe("req_2")
  })

  it("preserves structured detail payload", async function () {
    const response = new Response(
      JSON.stringify({ detail: { code: "invalid_input", field: "email" } }),
      {
        status: 422,
        headers: { "content-type": "application/json" },
      }
    )
    const detail = await readErrorDetail(response)
    expect(detail.detail).toBe('{"code":"invalid_input","field":"email"}')
  })

  it("falls back to text body when response is not json", async function () {
    const response = new Response("upstream timeout", {
      status: 504,
      statusText: "Gateway Timeout",
      headers: { "content-type": "text/plain" },
    })
    const detail = await readErrorDetail(response)
    expect(detail.detail).toBe("upstream timeout")
  })

  it("falls back to status text when clone is unavailable and json parsing fails", async function () {
    const response = {
      status: 418,
      statusText: "Teapot",
      headers: new Headers(),
      json: async () => {
        throw new Error("bad json")
      },
    } as Response

    const detail = await readErrorDetail(response)
    expect(detail.detail).toBe("Teapot")
    expect(detail.requestId).toBeNull()
  })

  it("formats api error without request id suffix when request id is absent", function () {
    expect(
      formatApiError("提交失败", {
        status: 500,
        detail: "boom",
        requestId: null,
      })
    ).toBe("提交失败：HTTP 500 - boom")
  })

  it("treats blank string detail as unknown error", async function () {
    const response = new Response(JSON.stringify({ detail: "   " }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })

    const detail = await readErrorDetail(response)
    expect(detail.detail).toBe("unknown error")
  })

  it("falls back to unserializable detail marker for circular payload detail", async function () {
    const circular: { self?: unknown } = {}
    circular.self = circular
    const response = {
      status: 500,
      statusText: "",
      headers: new Headers(),
      clone: () => null,
      json: async () => ({ detail: circular }),
    } as unknown as Response

    const detail = await readErrorDetail(response)
    expect(detail.detail).toBe("[unserializable detail]")
  })

  it("uses unknown error for null detail payload", async function () {
    const response = new Response(JSON.stringify({ detail: null }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })

    const detail = await readErrorDetail(response)
    expect(detail.detail).toBe("unknown error")
  })
})
