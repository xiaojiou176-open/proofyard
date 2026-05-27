import type { Command, CommandCategory } from "../types"

const HIGH_RISK_COMMAND_IDS = new Set([
  "setup",
  "clean",
  "map",
  "diagnose",
  "dev-frontend",
  "automation-install",
  "automation-record",
  "automation-record-manual",
  "automation-record-midscene",
])

const HELPER_COMMAND_IDS = new Set([
  "run-legacy",
  "run-midscene",
  "run-ui",
  "run-ui-midscene",
  "automation-record",
  "automation-record-manual",
  "automation-record-midscene",
])

export const categoryMeta: Record<CommandCategory, { label: string; className: string }> = {
  init: { label: "Initialize", className: "cat-init" },
  pipeline: { label: "Pipeline", className: "cat-pipeline" },
  frontend: { label: "Frontend", className: "cat-frontend" },
  automation: { label: "Automation", className: "cat-automation" },
  maintenance: { label: "Maintenance", className: "cat-maintenance" },
  backend: { label: "Backend", className: "cat-backend" },
}

export function guessCategory(command: Command): CommandCategory {
  const all = [command.command_id, command.title, ...command.tags].join(" ").toLowerCase()
  if (all.includes("setup") || all.includes("init")) return "init"
  if (
    all.includes("pipeline") ||
    all.includes("run-ui") ||
    all.includes("run-midscene") ||
    all.includes("run")
  )
    return "pipeline"
  if (all.includes("frontend")) return "frontend"
  if (all.includes("backend")) return "backend"
  if (
    all.includes("clean") ||
    all.includes("map") ||
    all.includes("diagnose") ||
    all.includes("maintenance")
  )
    return "maintenance"
  return "automation"
}

export function isDangerous(command: Command): boolean {
  const commandId = command.command_id.toLowerCase()
  if (HIGH_RISK_COMMAND_IDS.has(commandId)) return true
  const text = `${command.command_id} ${command.title} ${command.description}`.toLowerCase()
  return text.includes("rm -rf") || text.includes("drop table")
}

export function isAiCommand(command: Command): boolean {
  return (
    command.tags.some((tag) => tag.toLowerCase() === "ai") ||
    command.command_id.includes("midscene")
  )
}

export function isHelperCommand(command: Command): boolean {
  if (HELPER_COMMAND_IDS.has(command.command_id)) return true
  return command.tags.some((tag) => {
    const normalized = tag.toLowerCase()
    return normalized === "helper" || normalized === "legacy" || normalized === "workshop"
  })
}

export function isCanonicalPrimaryCommand(command: Command): boolean {
  return command.command_id === "run"
}
