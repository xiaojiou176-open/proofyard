import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@uiq/ui"
import type { ConfigStudioDocument, TaskState } from "../types"

type DraftMap = Record<string, string | number | boolean | null>

interface ProfileTargetStudioPanelProps {
  state: TaskState
  error: string
  profileOptions: string[]
  targetOptions: string[]
  selectedProfile: string
  selectedTarget: string
  profileDocument: ConfigStudioDocument | null
  targetDocument: ConfigStudioDocument | null
  onLoad: (options?: { profileName?: string; targetName?: string }) => void
  onSave: (
    kind: "profile" | "target",
    configName: string,
    updates: Record<string, unknown>
  ) => Promise<boolean> | boolean
}

function buildInitialDraft(document: ConfigStudioDocument | null): DraftMap {
  if (!document) return {}
  return Object.fromEntries(document.editable_fields.map((field) => [field.path, field.value]))
}

function stringifyReadonlyValue(value: unknown): string {
  if (value === null || value === undefined) return "None"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return "Unserializable"
  }
}

function renderFieldGroups(
  document: ConfigStudioDocument | null,
  draft: DraftMap,
  setDraft: Dispatch<SetStateAction<DraftMap>>
): JSX.Element[] {
  if (!document) return []
  const groups = new Map<string, typeof document.editable_fields>()
  for (const field of document.editable_fields) {
    const existing = groups.get(field.group) ?? []
    existing.push(field)
    groups.set(field.group, existing)
  }
  return [...groups.entries()].map(([group, fields]) => (
    <div key={`${document.kind}-${group}`} className="studio-config-group">
      <h4>{group}</h4>
      <div className="studio-config-fields">
        {fields.map((field) => {
          const currentValue = draft[field.path]
          if (field.field_type === "boolean") {
            return (
              <label key={field.path} className="studio-config-field">
                <span>{field.label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(currentValue)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked
                    setDraft((prev) => ({ ...prev, [field.path]: checked }))
                  }}
                />
                <small>{field.description}</small>
              </label>
            )
          }
          if (field.field_type === "enum") {
            return (
              <label key={field.path} className="studio-config-field">
                <span>{field.label}</span>
                <select
                  value={String(currentValue ?? "")}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, [field.path]: event.currentTarget.value }))
                  }
                >
                  {field.enum_values.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <small>{field.description}</small>
              </label>
            )
          }
          const isNumber = field.field_type === "integer" || field.field_type === "number"
          return (
            <label key={field.path} className="studio-config-field">
              <span>{field.label}</span>
              <input
                type={isNumber ? "number" : "text"}
                step={field.field_type === "integer" ? "1" : "any"}
                min={field.min_value ?? undefined}
                max={field.max_value ?? undefined}
                value={currentValue === null || currentValue === undefined ? "" : String(currentValue)}
                onChange={(event) => {
                  const raw = event.currentTarget.value
                  setDraft((prev) => ({
                    ...prev,
                    [field.path]:
                      field.field_type === "integer"
                        ? (raw === "" ? null : Number.parseInt(raw, 10))
                        : field.field_type === "number"
                          ? (raw === "" ? null : Number.parseFloat(raw))
                          : raw,
                  }))
                }}
              />
              <small>{field.description}</small>
            </label>
          )
        })}
      </div>
    </div>
  ))
}

function collectUpdates(document: ConfigStudioDocument | null, draft: DraftMap): Record<string, unknown> {
  if (!document) return {}
  const updates: Record<string, unknown> = {}
  for (const field of document.editable_fields) {
    if (draft[field.path] !== field.value) {
      updates[field.path] = draft[field.path]
    }
  }
  return updates
}

export default function ProfileTargetStudioPanel({
  state,
  error,
  profileOptions,
  targetOptions,
  selectedProfile,
  selectedTarget,
  profileDocument,
  targetDocument,
  onLoad,
  onSave,
}: ProfileTargetStudioPanelProps) {
  const [profileDraft, setProfileDraft] = useState<DraftMap>({})
  const [targetDraft, setTargetDraft] = useState<DraftMap>({})

  useEffect(() => {
    setProfileDraft(buildInitialDraft(profileDocument))
  }, [profileDocument])

  useEffect(() => {
    setTargetDraft(buildInitialDraft(targetDocument))
  }, [targetDocument])

  const profileUpdates = useMemo(
    () => collectUpdates(profileDocument, profileDraft),
    [profileDocument, profileDraft]
  )
  const targetUpdates = useMemo(
    () => collectUpdates(targetDocument, targetDraft),
    [targetDocument, targetDraft]
  )

  return (
    <Card data-testid="profile-target-studio-panel">
      <CardHeader>
        <CardTitle>{"Profile / Target Studio"}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="workshop-advanced-note">
          {
            "This is a guarded editor, not a raw YAML textbox. Only allowlisted strategy knobs are writable, and every save re-runs the canonical config validation before and after the write."
          }
        </p>
        <div className="workshop-command-pills">
          <Badge variant={state === "success" ? "success" : "secondary"}>
            {state === "success" ? "Studio config loaded" : "Studio config not loaded yet"}
          </Badge>
          <Badge variant="outline">{"High-risk fields stay read-only"}</Badge>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="form-actions mt-2">
          <Button
            size="sm"
            data-uiq-ignore-button-inventory="profile-target-studio-load-secondary-action"
            onClick={() => onLoad()}
          >
            {"Load current config surfaces"}
          </Button>
        </div>

        <div className="studio-config-layout">
          <section className="studio-config-column">
            <div className="studio-config-header">
              <h3>{"Profile knobs"}</h3>
              <select
                value={selectedProfile}
                onChange={(event) => onLoad({ profileName: event.currentTarget.value, targetName: selectedTarget })}
              >
                {profileOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {profileDocument ? (
              <>
                <p className="hint-text">{profileDocument.file_path}</p>
                <div className="field mb-3">
                  <span className="field-label">{"Guardrails"}</span>
                  <ul className="hint-text">
                    {profileDocument.validation_summary.map((item) => (
                      <li key={`${profileDocument.config_name}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <p className="hint-text">{`${Object.keys(profileUpdates).length} unsaved profile change(s)`}</p>
                {renderFieldGroups(profileDocument, profileDraft, setProfileDraft)}
                <div className="form-actions mt-2">
                  <Button
                    size="sm"
                    data-uiq-ignore-button-inventory="profile-target-studio-save-secondary-action"
                    onClick={() => void onSave("profile", profileDocument.config_name, profileUpdates)}
                    disabled={Object.keys(profileUpdates).length === 0}
                  >
                    {"Save profile changes"}
                  </Button>
                </div>
                <div className="studio-config-readonly">
                  <h4>{"Read-only profile fields"}</h4>
                  {profileDocument.readonly_fields.map((field) => (
                    <p key={field.path}>
                      <strong>{field.label}:</strong> {stringifyReadonlyValue(field.value)}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <p className="hint-text">{"Load the studio surface to edit profile controls."}</p>
            )}
          </section>

          <section className="studio-config-column">
            <div className="studio-config-header">
              <h3>{"Target knobs"}</h3>
              <select
                value={selectedTarget}
                onChange={(event) => onLoad({ profileName: selectedProfile, targetName: event.currentTarget.value })}
              >
                {targetOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {targetDocument ? (
              <>
                <p className="hint-text">{targetDocument.file_path}</p>
                <div className="field mb-3">
                  <span className="field-label">{"Guardrails"}</span>
                  <ul className="hint-text">
                    {targetDocument.validation_summary.map((item) => (
                      <li key={`${targetDocument.config_name}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <p className="hint-text">{`${Object.keys(targetUpdates).length} unsaved target change(s)`}</p>
                {renderFieldGroups(targetDocument, targetDraft, setTargetDraft)}
                <div className="form-actions mt-2">
                  <Button
                    size="sm"
                    data-uiq-ignore-button-inventory="profile-target-studio-save-secondary-action"
                    onClick={() => void onSave("target", targetDocument.config_name, targetUpdates)}
                    disabled={Object.keys(targetUpdates).length === 0}
                  >
                    {"Save target changes"}
                  </Button>
                </div>
                <div className="studio-config-readonly">
                  <h4>{"Read-only target fields"}</h4>
                  {targetDocument.readonly_fields.map((field) => (
                    <p key={field.path}>
                      <strong>{field.label}:</strong> {stringifyReadonlyValue(field.value)}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <p className="hint-text">{"Load the studio surface to edit target controls."}</p>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}
