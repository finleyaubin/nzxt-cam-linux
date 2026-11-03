import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { languages, Lang, TranslationKey, SOURCE_LANG } from './languages'

const STORAGE_KEY = 'nzxtcam-lang'
const LEGACY_LANGS: Record<string, Lang> = { en: 'en_us', fr: 'fr_fr' }

const isLang = (value: string): value is Lang => value in languages

function fromBrowserLocale(locale: string): Lang | undefined {
  const [language, region] = locale.toLowerCase().split('-')
  const exact = `${language}_${region}`
  if (isLang(exact)) return exact
  return (Object.keys(languages) as Lang[]).find(l => l.startsWith(`${language}_`))
}

function detectDefault(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && isLang(stored)) return stored
  if (stored && stored in LEGACY_LANGS) return LEGACY_LANGS[stored]
  return fromBrowserLocale(navigator.language) ?? SOURCE_LANG
}

interface LangCtx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: TranslationKey) => string
}

const LangContext = createContext<LangCtx | null>(null)

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectDefault)

  useEffect(() => {
    const [language, region] = lang.split('_')
    document.documentElement.lang = `${language}-${region.toUpperCase()}`
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l)
    setLangState(l)
  }, [])

  // Other languages may omit keys; those show the English text.
  const t = useCallback((key: TranslationKey): string => {
    const text = (languages[lang] as Record<string, string>)[key] ?? languages[SOURCE_LANG][key]
    if (text === undefined) throw new Error(`Missing translation key: ${key}`)
    return text
  }, [lang])

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLanguage must be used inside LangProvider')
  return ctx
}
