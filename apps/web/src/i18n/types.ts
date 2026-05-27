export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export type TranslationValues = Record<string, number | string>

export function isSupportedLocale(value: string | null | undefined): value is AppLocale {
  return value === "en" || value === "zh-CN"
}
