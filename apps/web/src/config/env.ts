export type FrontendEnv = {
  VITE_DEFAULT_BASE_URL?: string
  VITE_DEFAULT_AUTOMATION_TOKEN?: string
  VITE_DEFAULT_AUTOMATION_CLIENT_ID?: string
}

export const FRONTEND_ENV: FrontendEnv = {
  VITE_DEFAULT_BASE_URL: import.meta.env.VITE_DEFAULT_BASE_URL as string | undefined,
  VITE_DEFAULT_AUTOMATION_TOKEN: import.meta.env.VITE_DEFAULT_AUTOMATION_TOKEN as string | undefined,
  VITE_DEFAULT_AUTOMATION_CLIENT_ID: import.meta.env.VITE_DEFAULT_AUTOMATION_CLIENT_ID as
    | string
    | undefined,
}
