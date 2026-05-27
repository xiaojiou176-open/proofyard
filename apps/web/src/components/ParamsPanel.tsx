import { memo, useState, type ChangeEvent } from "react"
import {
  PARAM_BASE_URL_INPUT_TEST_ID,
  PARAM_REGISTER_PASSWORD_INPUT_TEST_ID,
} from "../constants/testIds"
import { Button, Input, Switch } from "@uiq/ui"

export const defaultStartUrlRoutePath = "/register"

export interface ParamsState {
  baseUrl: string
  startUrl: string
  successSelector: string
  modelName: string
  geminiApiKey?: string
  registerPassword: string
  automationToken: string
  automationClientId: string
  headless: boolean
  midsceneStrict: boolean
}

interface ParamsPanelProps {
  params: ParamsState
  onChange: (patch: Partial<ParamsState>) => void
}

function ParamsPanel({ params, onChange }: ParamsPanelProps) {
  const [showToken, setShowToken] = useState(false)
  const [showGeminiApiKey, setShowGeminiApiKey] = useState(false)
  const [showRegisterPassword, setShowRegisterPassword] = useState(false)

  return (
    <div className="form-section">
      <h3 className="form-section-title">{"Run Parameters"}</h3>
      <div className="field-group">
        <div className="field">
          <label className="field-label" htmlFor="base-url">
            {"Target site URL (UIQ_BASE_URL)"}
          </label>
          <Input
            id="base-url"
            type="url"
            data-testid={PARAM_BASE_URL_INPUT_TEST_ID}
            value={params.baseUrl}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ baseUrl: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="start-url">
            {"Start URL (START_URL)"}
          </label>
          <Input
            id="start-url"
            type="url"
            value={params.startUrl}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ startUrl: e.target.value })}
            placeholder={`Optional; defaults to base URL + ${defaultStartUrlRoutePath}`}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="success-selector">
            {"Success selector"}
          </label>
          <Input
            id="success-selector"
            type="text"
            value={params.successSelector}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChange({ successSelector: e.target.value })
            }
            placeholder="e.g. .success-message or #welcome"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="model-name">
            {"Gemini model"}
          </label>
          <Input
            id="model-name"
            type="text"
            value={params.modelName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ modelName: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="api-key">
            {"Gemini API key (optional)"}
          </label>
          <div className="field-row">
            <Input
              id="api-key"
              type={showGeminiApiKey ? "text" : "password"}
              autoComplete="off"
              value={params.geminiApiKey ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onChange({ geminiApiKey: e.target.value })
              }
              placeholder="Only fill this when GEMINI_API_KEY is injected locally or in CI"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="params-toggle-api-key-visibility"
              aria-controls="api-key"
              aria-pressed={showGeminiApiKey}
              onClick={() => setShowGeminiApiKey((v) => !v)}
            >
              {showGeminiApiKey ? "Hide" : "Show"}
            </Button>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="register-password">
            {"Registration password (optional)"}
          </label>
          <div className="field-row">
            <Input
              id="register-password"
              type={showRegisterPassword ? "text" : "password"}
              data-testid={PARAM_REGISTER_PASSWORD_INPUT_TEST_ID}
              data-uiq-ignore-button-inventory="non-core-parameter-input"
              autoComplete="off"
              value={params.registerPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onChange({ registerPassword: e.target.value })
              }
              placeholder="Only fill this when the target site requires a fixed registration password"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="params-toggle-register-password-visibility"
              aria-controls="register-password"
              aria-pressed={showRegisterPassword}
              onClick={() => setShowRegisterPassword((v) => !v)}
            >
              {showRegisterPassword ? "Hide" : "Show"}
            </Button>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="automation-token">
            {"API token"}
          </label>
          <div className="field-row">
            <Input
              id="automation-token"
              type={showToken ? "text" : "password"}
              autoComplete="off"
              value={params.automationToken}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onChange({ automationToken: e.target.value })
              }
              placeholder="Only fill this when backend auth is enabled"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="params-toggle-token-visibility"
              aria-controls="automation-token"
              aria-pressed={showToken}
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? "Hide" : "Show"}
            </Button>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="automation-client-id">
            {"Client ID"}
          </label>
          <Input
            id="automation-client-id"
            type="text"
            autoComplete="off"
            value={params.automationClientId}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChange({ automationClientId: e.target.value })
            }
            placeholder="Generated on first run; you can override it manually"
          />
        </div>
        <div className="switch-group">
          <label className="switch-label" htmlFor="params-headless">
            <Switch
              id="params-headless"
              checked={params.headless}
              onCheckedChange={(value: boolean) => onChange({ headless: value })}
            />
            {"Run browser in the background (headless)"}
          </label>
          <label className="switch-label" htmlFor="params-midscene-strict">
            <Switch
              id="params-midscene-strict"
              checked={params.midsceneStrict}
              onCheckedChange={(value: boolean) => onChange({ midsceneStrict: value })}
            />
            {"Use strict element recognition (Midscene strict)"}
          </label>
        </div>
      </div>
    </div>
  )
}

export default memo(ParamsPanel)
