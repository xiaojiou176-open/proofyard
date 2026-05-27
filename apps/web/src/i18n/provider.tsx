import { useEffect, useMemo, type PropsWithChildren } from "react"

import { I18nContext, type I18nContextValue } from "./context"
import { translate } from "./messages"
import type { AppLocale } from "./types"

type I18nProviderProps = PropsWithChildren<{
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
}>

export function I18nProvider({ locale, setLocale, children }: I18nProviderProps) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (message, values) => translate(locale, message, values),
    }),
    [locale, setLocale]
  )

  useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.lang = locale
  }, [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
