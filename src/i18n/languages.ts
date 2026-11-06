import en_us from './lang/en_us.json'
import fr_fr from './lang/fr_fr.json'
import es_es from './lang/es_es.json'
import de_de from './lang/de_de.json'
import pt_br from './lang/pt_br.json'
import cy_gb from './lang/cy_gb.json'

export const languages = { en_us, fr_fr, es_es, de_de, pt_br, cy_gb }

export type Lang = keyof typeof languages
export type TranslationKey = keyof typeof en_us

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

export const SOURCE_LANG: Lang = 'en_us'
