/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_BASE_URL?: string
  readonly VITE_DEFAULT_AUTOMATION_TOKEN?: string
  readonly VITE_DEFAULT_AUTOMATION_CLIENT_ID?: string
  readonly VITE_RUM_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
