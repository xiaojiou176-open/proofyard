# Debt Register

This register tracks temporary governance exceptions and the concrete exit path
for each one.

| ID | Type | Path | Risk | Owner Role | Due Date | Exit Criteria | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DEBT-FIRSTPARTY-LENGTH-001 | gate_failure | scripts/ci/run-in-container.sh | high | platform-owner | 2026-04-13 | Split CI task routing into smaller gate-specific entrypoints so this file drops below 800 lines. | open |
| DEBT-FIRSTPARTY-LENGTH-002 | gate_failure | scripts/runtime-gc.sh | medium | platform-owner | 2026-04-13 | Extract runtime cleanup phases into smaller shared helpers so the GC orchestrator stays below 800 lines. | open |
| DEBT-FIRSTPARTY-LENGTH-003 | gate_failure | apps/mcp-server/src/tools/register-tools/register-run-tools.ts | high | platform-owner | 2026-04-13 | Break the run tool registry into capability-scoped modules so the main registration file drops below 800 lines. | open |
| DEBT-FIRSTPARTY-LENGTH-004 | gate_failure | apps/web/src/views/TaskCenterView.tsx | medium | frontend-owner | 2026-04-13 | Split Task Center into dedicated run-record, evidence, and detail containers so the view stays below 800 lines. | open |
| DEBT-FIRSTPARTY-LENGTH-005 | gate_failure | apps/api/app/services/automation_service.py | high | backend-owner | 2026-04-13 | Extract scheduler/runtime/persistence responsibilities into smaller services so automation_service.py drops below 800 lines. | open |
