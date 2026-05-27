import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")

const requiredContracts = [
  {
    type: "literal",
    file: "apps/web/src/constants/testIds.ts",
    reason: "missing testid literal",
    entries: [
      "console-tab-quick-launch",
      "console-tab-task-center",
      "console-tab-flow-draft",
      "task-center-tab-command-runs",
      "task-center-tab-template-runs",
      "task-center-panel-command-runs",
      "task-center-panel-template-runs",
      "task-center-command-runs-refresh",
      "task-center-template-runs-refresh",
      "quick-launch-first-use-locate-config",
      "command-category-all",
      "command-category-frontend",
      "command-category-maintenance",
      "param-base-url-input",
      "param-register-password-input",
    ],
  },
  {
    type: "symbol",
    file: "apps/web/src/components/ConsoleHeader.tsx",
    reason: "missing testid constant reference",
    entries: [
      "CONSOLE_TAB_QUICK_LAUNCH_TEST_ID",
      "CONSOLE_TAB_TASK_CENTER_TEST_ID",
      "CONSOLE_TAB_FLOW_DRAFT_TEST_ID",
    ],
  },
  {
    type: "symbol",
    file: "apps/web/src/components/CommandGrid.tsx",
    reason: "missing testid constant reference",
    entries: [
      "COMMAND_CATEGORY_ALL_TEST_ID",
      "COMMAND_CATEGORY_FRONTEND_TEST_ID",
      "COMMAND_CATEGORY_MAINTENANCE_TEST_ID",
    ],
  },
  {
    type: "symbol",
    file: "apps/web/src/views/TaskCenterView.tsx",
    reason: "missing testid constant reference",
    entries: [
      "TASK_CENTER_TAB_COMMAND_RUNS_TEST_ID",
      "TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID",
      "TASK_CENTER_PANEL_COMMAND_RUNS_TEST_ID",
      "TASK_CENTER_PANEL_TEMPLATE_RUNS_TEST_ID",
      "TASK_CENTER_COMMAND_RUNS_REFRESH_TEST_ID",
      "TASK_CENTER_TEMPLATE_RUNS_REFRESH_TEST_ID",
    ],
  },
  {
    type: "symbol",
    file: "apps/web/src/views/QuickLaunchView.tsx",
    reason: "missing testid constant reference",
    entries: ["QUICK_LAUNCH_FIRST_USE_LOCATE_CONFIG_TEST_ID"],
  },
  {
    type: "symbol",
    file: "apps/web/src/components/ParamsPanel.tsx",
    reason: "missing testid constant reference",
    entries: ["PARAM_BASE_URL_INPUT_TEST_ID", "PARAM_REGISTER_PASSWORD_INPUT_TEST_ID"],
  },
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function hasStringLiteral(content, value) {
  return content.includes(`'${value}'`) || content.includes(`"${value}"`)
}

function hasSymbolReference(content, symbol) {
  return content.includes(symbol)
}

const missingContracts = []

for (const contract of requiredContracts) {
  const absolutePath = path.join(repoRoot, contract.file)
  let content = ""
  try {
    content = await fs.readFile(absolutePath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    for (const entry of contract.entries) {
      missingContracts.push({
        entry,
        file: contract.file,
        reason: `unable to read file (${message})`,
      })
    }
    continue
  }

  for (const entry of contract.entries) {
    const exists =
      contract.type === "literal"
        ? hasStringLiteral(content, entry)
        : hasSymbolReference(content, entry)

    if (!exists) {
      missingContracts.push({
        entry,
        file: contract.file,
        reason: contract.reason,
      })
    }
  }
}

if (missingContracts.length > 0) {
  console.error("[check-e2e-contract] Missing required E2E contract entries:")
  for (const item of missingContracts) {
    console.error(`- file=${item.file} entry=${item.entry} reason=${item.reason}`)
  }
  process.exit(1)
}

console.log("[check-e2e-contract] OK: required E2E testid contract is complete.")
