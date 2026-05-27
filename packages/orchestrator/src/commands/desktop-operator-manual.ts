export function buildDesktopOperatorManualDetail(commandId: string): string {
  return `${commandId} remains an operator-manual lane under host-process safety governance; the owner may execute the desktop steps manually, while agent-driven desktop control stays disabled and manual evidence must be captured by the owner.`
}

export function buildDesktopOperatorManualReasonCode(commandId: string): string {
  return `${commandId}.operator_manual_only`
}
