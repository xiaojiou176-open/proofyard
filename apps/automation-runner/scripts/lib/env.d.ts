export type AutomationEnv = Record<string, string | undefined>

export const AUTOMATION_ENV: AutomationEnv

export function automationEnv(key: string, fallback?: string): string
export function automationBool(key: string, fallback?: boolean): boolean
export function automationInt(key: string, fallback: number): number
