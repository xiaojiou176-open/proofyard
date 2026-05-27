import { useCallback } from "react"
import type { UniversalRun } from "../types"
import { formatApiError, readErrorDetail } from "../utils/api"
import {
  buildApiUrl,
  formatActionableApiError,
  normalizeTransportErrorMessage,
  unwrapRunPayload as unwrapRunPayloadHelper,
} from "./useApiClient.helpers"
import type { AppStore } from "./useAppStore"

export type ApiClientTransport = {
  buildHeaders: () => Record<string, string>
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  assertResponseOk: (response: Response, message: string) => Promise<void>
  requestJson: <T>(path: string, message: string, init?: RequestInit) => Promise<T>
  runAction: <T>(
    fallbackMessage: string,
    onError: (formatted: string) => void,
    action: () => Promise<T>
  ) => Promise<T | null>
  formatActionableError: (message: string, action?: string, entry?: string) => string
  unwrapRunPayload: (payload: unknown) => UniversalRun | null
}

export function useApiClientTransport(store: AppStore): ApiClientTransport {
  const normalizeTransportError = useCallback(
    (message: string) => normalizeTransportErrorMessage(message),
    []
  )

  const unwrapRunPayload = useCallback(
    (payload: unknown): UniversalRun | null => unwrapRunPayloadHelper(payload),
    []
  )

  const formatActionableError = useCallback(
    (
      message: string,
      action = "Correct the current step input and try again.",
      entry = "Review the Task Center run log and the browser developer-tools network panel."
    ) => formatActionableApiError(message, action, entry),
    []
  )

  const buildHeaders = useCallback(() => {
    const headers: Record<string, string> = {}
    const token = store.params.automationToken.trim()
    if (token) {
      headers["x-automation-token"] = token
      const clientId = store.params.automationClientId.trim()
      if (clientId) headers["x-automation-client-id"] = clientId
    }
    return headers
  }, [store.params.automationClientId, store.params.automationToken])

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      try {
        return await fetch(buildApiUrl(store.params.baseUrl, path), init)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(normalizeTransportError(message))
      }
    },
    [normalizeTransportError, store.params.baseUrl]
  )

  const assertResponseOk = useCallback(async (response: Response, message: string) => {
    if (response.ok) return
    throw new Error(formatApiError(message, await readErrorDetail(response)))
  }, [])

  const requestJson = useCallback(
    async <T>(path: string, message: string, init?: RequestInit): Promise<T> => {
      const response = await apiFetch(path, init)
      await assertResponseOk(response, message)
      return (await response.json()) as T
    },
    [apiFetch, assertResponseOk]
  )

  const runAction = useCallback(
    async <T>(
      fallbackMessage: string,
      onError: (formatted: string) => void,
      action: () => Promise<T>
    ): Promise<T | null> => {
      try {
        return await action()
      } catch (error) {
        const message = error instanceof Error ? error.message : fallbackMessage
        const formatted = formatActionableError(message)
        onError(formatted)
        return null
      }
    },
    [formatActionableError]
  )

  return {
    buildHeaders,
    apiFetch,
    assertResponseOk,
    requestJson,
    runAction,
    formatActionableError,
    unwrapRunPayload,
  }
}
