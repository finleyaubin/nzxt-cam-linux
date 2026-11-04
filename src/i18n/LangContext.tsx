import { createContext, useContext, useState, useCallback, useEffect, Fragment, ReactNode } from 'react'
import { languages, Lang, TranslationKey, SOURCE_LANG } from './languages'

const STORAGE_KEY = 'nzxtcam-lang'
const LEGACY_LANGS: Record<string, Lang> = { en: 'en_us', fr: 'fr_fr' }

const PLACEHOLDER = /\{(\w+)\}/g

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
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  tRich: (key: TranslationKey, parts: Record<string, ReactNode>) => ReactNode
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
  const template = useCallback((key: TranslationKey): string => {
    const text = (languages[lang] as Record<string, string>)[key] ?? languages[SOURCE_LANG][key]
    if (text === undefined) throw new Error(`Missing translation key: ${key}`)
    return text
  }, [lang])

  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>): string => {
    const text = template(key)
    if (!params) return text
    return text.replace(PLACEHOLDER, (_, name) => {
      if (!(name in params)) throw new Error(`Missing parameter {${name}} for ${key}`)
      return String(params[name])
    })
  }, [template])

  // Like t(), but placeholders are filled with elements (e.g. <code>) instead of strings.
  const tRich = useCallback((key: TranslationKey, parts: Record<string, ReactNode>): ReactNode =>
    template(key).split(PLACEHOLDER).map((piece, i) => {
      if (i % 2 === 0) return piece
      if (!(piece in parts)) throw new Error(`Missing parameter {${piece}} for ${key}`)
      return <Fragment key={i}>{parts[piece]}</Fragment>
    }), [template])

  return <LangContext.Provider value={{ lang, setLang, t, tRich }}>{children}</LangContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLanguage must be used inside LangProvider')
  return ctx
}
