import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import ProfileTargetStudioPanel from "./ProfileTargetStudioPanel"

describe("ProfileTargetStudioPanel", () => {
  it("renders allowlisted editable fields and readonly summaries", () => {
    const html = renderToStaticMarkup(
      <ProfileTargetStudioPanel
        state="success"
        error=""
        profileOptions={["pr"]}
        targetOptions={["web.local"]}
        selectedProfile="pr"
        selectedTarget="web.local"
        onLoad={() => {}}
        onSave={async () => true}
        profileDocument={{
          kind: "profile",
          config_name: "pr",
          file_path: "configs/profiles/pr.yaml",
          editable_fields: [
            {
              path: "gates.consoleErrorMax",
              label: "Console error max",
              group: "Gates",
              field_type: "integer",
              value: 0,
              description: "Maximum allowed console errors.",
              min_value: 0,
              max_value: 1000000,
              enum_values: [],
            },
          ],
          readonly_fields: [
            { path: "steps", label: "Execution steps", value: ["unit", "contract"] },
          ],
          validation_summary: ["Pre-save: canonical profile/target schema validation"],
        }}
        targetDocument={{
          kind: "target",
          config_name: "web.local",
          file_path: "configs/targets/web.local.yaml",
          editable_fields: [
            {
              path: "explore.budgetSeconds",
              label: "Explore budget",
              group: "Explore",
              field_type: "integer",
              value: 180,
              description: "Exploration budget in seconds.",
              min_value: 1,
              max_value: 86400,
              enum_values: [],
            },
          ],
          readonly_fields: [
            { path: "baseUrl", label: "Base URL", value: "http://127.0.0.1:43173" },
          ],
          validation_summary: ["Post-save: pnpm check:config-drift"],
        }}
      />
    )

    expect(html).toContain("Profile / Target Studio")
    expect(html).toContain("Console error max")
    expect(html).toContain("Execution steps")
    expect(html).toContain("Explore budget")
    expect(html).toContain("Base URL")
    expect(html).toContain("Guardrails")
    expect(html).toContain("canonical profile/target schema validation")
    expect(html).toContain("unsaved profile change(s)")
    expect(html).toContain("unsaved target change(s)")
  })
})
