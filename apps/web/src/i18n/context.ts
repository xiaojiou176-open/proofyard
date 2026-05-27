import { createContext } from "react"

import { translate } from "./messages"
import type { AppLocale, TranslationValues } from "./types"

export type I18nContextValue = {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  t: (message: string, values?: TranslationValues) => string
}

const defaultContext: I18nContextValue = {
  locale: "en",
  setLocale: () => {},
  t: (message, values) => translate("en", message, values),
}

export const I18nContext = createContext<I18nContextValue>(defaultContext)
