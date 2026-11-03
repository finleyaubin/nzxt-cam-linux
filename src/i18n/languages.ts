import en_us from './lang/en_us.json'
import fr_fr from './lang/fr_fr.json'

export const languages = { en_us, fr_fr }

export type Lang = keyof typeof languages
export type TranslationKey = keyof typeof en_us

export const SOURCE_LANG: Lang = 'en_us'
