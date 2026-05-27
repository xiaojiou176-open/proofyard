import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import RunDetailCard from "./RunDetailCard"

describe("RunDetailCard", () => {
  it("renders success status variant and detail hint", () => {
    const html = renderToStaticMarkup(
      <RunDetailCard title="执行详情" status="success" isSuccess detailHint="流程已完成">
        <div>{"Body content"}</div>
      </RunDetailCard>
    )

    expect(html).toContain("执行详情")
    expect(html).toContain("流程已完成")
    expect(html).toContain("Body content")
    expect(html).toContain("ui-badge--success")
    expect(html).toContain(">success<")
  })

  it("renders default status variant when run is not successful", () => {
    const html = renderToStaticMarkup(
      <RunDetailCard title="执行详情" status="running" isSuccess={false} detailHint="流程进行中">
        <p>{"Streaming logs"}</p>
      </RunDetailCard>
    )

    expect(html).toContain("ui-badge--default")
    expect(html).toContain(">running<")
    expect(html).toContain("Streaming logs")
  })
})
