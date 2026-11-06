import { useApp } from '../context/AppContext'
import { useLanguage } from '../i18n/LangContext'
import type { TranslationKey } from '../i18n/languages'
import { Pulse, Snowflake, Lightbulb, Monitor, Gear } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'

type Section = 'monitoring' | 'cooling' | 'lighting' | 'lcd' | 'settings'

const NAV: { id: Section; label: TranslationKey; Icon: Icon }[] = [
  { id: 'monitoring', label: 'nav.monitoring', Icon: Pulse },
  { id: 'cooling',    label: 'nav.cooling',    Icon: Snowflake },
  { id: 'lighting',   label: 'nav.lighting',   Icon: Lightbulb },
  { id: 'lcd',        label: 'nav.lcd',        Icon: Monitor },
  { id: 'settings',   label: 'nav.settings',   Icon: Gear },
]

export function AppSidebar() {
  const { t } = useLanguage()
  const { state, dispatch } = useApp()
  const { section, compact } = state

  return (
    <nav style={{
      width: compact ? 56 : 220, flexShrink: 0, padding: 8, display: 'flex', flexDirection: 'column', gap: 2,
      background: 'var(--window)', boxShadow: '1px 0 0 var(--border)',
    }}>
      {NAV.map(({ id, label, Icon }) => {
        const active = section === id
        return (
          <button key={id} className={active ? undefined : 'adw-row'} title={t(label)}
            onClick={() => dispatch({ type: 'SET_SECTION', payload: id })}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: compact ? '9px 0' : '9px 12px',
              justifyContent: compact ? 'center' : 'flex-start', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: active ? 'var(--selected)' : 'transparent', fontWeight: active ? 700 : 400, textAlign: 'left',
              marginTop: id === 'settings' ? 'auto' : 0,
            }}>
            <Icon size={18} weight={active ? 'fill' : 'regular'} style={{ flexShrink: 0 }}/>
            {!compact && <span>{t(label)}</span>}
          </button>
        )
      })}
    </nav>
  )
}
