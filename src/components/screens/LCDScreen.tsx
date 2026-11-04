import { DisplayEditor } from '../display/DisplayEditor'
import { useLanguage } from '../../i18n/LangContext'

export function LCDScreen() {
  const { t } = useLanguage()
  return (
    <div style={{ height: '100%', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>{t('nav.lcd')}</div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DisplayEditor/>
      </div>
    </div>
  )
}
