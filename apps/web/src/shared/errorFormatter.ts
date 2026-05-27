const STRUCTURED_ERROR_TOKENS = ["Issue:", "Suggested action:", "Troubleshooting:"] as const

export interface ActionableErrorFormatOptions {
  action: string
  troubleshootingEntry: string
}

export const formatActionableErrorMessage = (
  message: string,
  options: ActionableErrorFormatOptions
): string => {
  const normalized = message.trim()
  if (!normalized) return ""
  if (STRUCTURED_ERROR_TOKENS.every((token) => normalized.includes(token))) {
    return normalized
  }
  return `Issue: ${normalized}. Suggested action: ${options.action}. Troubleshooting: ${options.troubleshootingEntry}`
}
