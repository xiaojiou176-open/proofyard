const NODE_ENV = process.env

function readEnv(env, key, fallback = "") {
  const value = env[key]
  if (value === undefined || value === null) return fallback
  return String(value)
}

function readBoolEnv(env, key, fallback = false) {
  const raw = readEnv(env, key, fallback ? "1" : "0")
    .trim()
    .toLowerCase()
  return ["1", "true", "yes", "on"].includes(raw)
}

function readIntEnv(env, key, fallback) {
  const raw = Number.parseInt(readEnv(env, key, String(fallback)).trim(), 10)
  if (!Number.isFinite(raw)) return fallback
  return raw
}

export const AUTOMATION_ENV = NODE_ENV

export function automationEnv(key, fallback = "") {
  return readEnv(AUTOMATION_ENV, key, fallback)
}

export function automationBool(key, fallback = false) {
  return readBoolEnv(AUTOMATION_ENV, key, fallback)
}

export function automationInt(key, fallback) {
  return readIntEnv(AUTOMATION_ENV, key, fallback)
}
