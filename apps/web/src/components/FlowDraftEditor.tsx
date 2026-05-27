import { memo, type ChangeEvent } from "react"
import type { FlowEditableDraft } from "../types"
import { Button, Input, Select } from "@uiq/ui"

interface FlowDraftEditorProps {
  draft: FlowEditableDraft | null
  selectedStepId: string
  onSelectStep: (stepId: string) => void
  onChange: (next: FlowEditableDraft) => void
  onSave: () => void
  onRunStep: (stepId: string) => void
  onResumeFromStep: (stepId: string) => void
}

function FlowDraftEditor({
  draft,
  selectedStepId,
  onSelectStep,
  onChange,
  onSave,
  onRunStep,
  onResumeFromStep,
}: FlowDraftEditorProps) {
  if (!draft) {
    return (
      <div className="empty-state p-4">
        <p className="empty-state-desc">{"No flow draft yet. Start one recording command first."}</p>
      </div>
    )
  }

  const updateStartUrl = (value: string) => {
    onChange({ ...draft, start_url: value })
  }

  const updateStep = (index: number, patch: Partial<FlowEditableDraft["steps"][number]>) => {
    const nextSteps = draft.steps.map((step, idx) => (idx === index ? { ...step, ...patch } : step))
    onChange({ ...draft, steps: nextSteps })
  }

  const removeStep = (index: number) => {
    const nextSteps = draft.steps.filter((_, idx) => idx !== index)
    onChange({ ...draft, steps: nextSteps })
  }

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= draft.steps.length) return
    const nextSteps = [...draft.steps]
    const current = nextSteps[index]
    nextSteps[index] = nextSteps[target]
    nextSteps[target] = current
    onChange({ ...draft, steps: nextSteps })
  }

  const addStep = () => {
    const nextIndex = draft.steps.length + 1
    onChange({
      ...draft,
      steps: [
        ...draft.steps,
        {
          step_id: `s${nextIndex}`,
          action: "click",
          selected_selector_index: 0,
          target: { selectors: [{ kind: "css", value: "body", score: 50 }] },
        },
      ],
    })
  }

  return (
    <div>
      <p className="hint-text mb-3">
        {"Start with the core flow. Step parameters and debugging fields stay inside collapsible sections so they do not interrupt the first run."}
      </p>
      <div className="field mb-3">
        <label className="field-label" htmlFor="flow-start-url">
          {"Flow start URL"}
        </label>
        <Input
          id="flow-start-url"
          value={draft.start_url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateStartUrl(e.target.value)}
        />
      </div>

      <div className="form-actions mb-3">
        <Button
          variant="outline"
          size="sm"
          onClick={addStep}
          data-uiq-ignore-button-inventory="flow-editor-add-step-secondary-action"
        >
          {"Add Step"}
        </Button>
        <Button size="sm" onClick={onSave}>
          {"Save Draft"}
        </Button>
      </div>

      <ul className="task-list vlist-xl" role="list" aria-label="flow-editor-steps">
        {draft.steps.map((step, index) => {
          const selectors = step.target?.selectors ?? []
          const selectedIndex = Math.max(
            0,
            Math.min(selectors.length - 1, step.selected_selector_index ?? 0)
          )
          return (
            <li
              key={`${step.step_id}-${index}`}
              className={`task-item flex-col ${selectedStepId === step.step_id ? "active" : ""}`}
            >
              <div className="flex-row justify-between gap-2 w-full">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-left"
                  aria-current={selectedStepId === step.step_id ? "true" : undefined}
                  onClick={() => onSelectStep(step.step_id)}
                >
                  <strong>{`${step.step_id} \u00B7 ${step.action}`}</strong>
                </Button>
                <div className="step-primary-actions">
                  <Button variant="outline" size="sm" onClick={() => onRunStep(step.step_id)}>
                    {"Replay Step"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onResumeFromStep(step.step_id)}>
                    {"Resume"}
                  </Button>
                </div>
              </div>

              <details className="debug-disclosure mt-2">
                <summary>{"Step parameters (action / URL / input reference)"}</summary>
                <div className="debug-disclosure-body">
                  <div className="form-row">
                    <Select
                      className="w-select-action"
                      value={step.action}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        updateStep(index, { action: e.target.value })
                      }
                      aria-label={`step-${index}-action`}
                    >
                      <option value="navigate">{"navigate"}</option>
                      <option value="click">{"click"}</option>
                      <option value="type">{"type"}</option>
                    </Select>
                  </div>

                  {step.action === "navigate" && (
                    <Input
                      className="mt-2"
                      value={step.url ?? ""}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updateStep(index, { url: e.target.value })
                      }
                      placeholder="https://example.com/path"
                      aria-label={`step-${index}-url`}
                    />
                  )}

                  {step.action === "type" && (
                    <Input
                      className="mt-2"
                      value={step.value_ref ?? ""}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updateStep(index, { value_ref: e.target.value })
                      }
                      placeholder="${params.input}"
                      aria-label={`step-${index}-value-ref`}
                    />
                  )}
                </div>
              </details>

              <details className="debug-disclosure mt-2">
                <summary>{"Advanced settings (step_id / selector / order)"}</summary>
                <div className="debug-disclosure-body">
                  <div className="form-row">
                    <Input
                      className="flex-1"
                      value={step.step_id}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updateStep(index, { step_id: e.target.value })
                      }
                      aria-label={`step-${index}-id`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveStep(index, -1)}
                      aria-label="Move up"
                      data-uiq-ignore-button-inventory="flow-editor-order-control"
                    >
                      {"\u2191"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveStep(index, 1)}
                      aria-label="Move down"
                      data-uiq-ignore-button-inventory="flow-editor-order-control"
                    >
                      {"\u2193"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => removeStep(index)}
                      data-uiq-ignore-button-inventory="flow-editor-delete-control"
                    >
                      {"\u2715"}
                    </Button>
                  </div>
                  <Select
                    className="mt-2"
                    value={String(selectedIndex)}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      updateStep(index, { selected_selector_index: Number(e.target.value) })
                    }
                    aria-label={`step-${index}-selector-index`}
                  >
                    {selectors.length === 0 ? (
                      <option value="0">{"No selector"}</option>
                    ) : (
                      selectors.map((selector, selectorIndex) => (
                        <option key={`${selector.kind}-${selectorIndex}`} value={selectorIndex}>
                          {`${selectorIndex + 1}. [${selector.kind}] ${selector.value}`}
                        </option>
                      ))
                    )}
                  </Select>
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default memo(FlowDraftEditor)
