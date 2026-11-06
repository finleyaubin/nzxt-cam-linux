import { useState, useEffect, ReactNode } from 'react'
import { useLanguage } from '../../i18n/LangContext'
import { useApp } from '../../context/AppContext'
import { Card } from '../ui/Card'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { Dropdown } from '../ui/Dropdown'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Settings, SettingsPage } from '../Settings'
import { ProfileManager } from '../ProfileManager'
import { api } from '../../lib/api'
import { languages, Lang, TranslationKey } from '../../i18n/languages'
import { GithubLogo, Bug, ChatCircle, CaretRight, Check, SlidersHorizontal, Pulse, Thermometer, PlugsConnected, Drop, Stack, Lifebuoy } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'

const ACCENT_COLORS: { name: TranslationKey; c: string }[] = [
  { name: 'accent.blue',   c: '#3584e4' },
  { name: 'accent.cyan',   c: '#2190a4' },
  { name: 'accent.green',  c: '#3a944a' },
  { name: 'accent.gold',   c: '#c88800' },
  { name: 'accent.ember',  c: '#e62d42' },
  { name: 'accent.rose',   c: '#d56199' },
  { name: 'accent.violet', c: '#9141ac' },
]

const languageIds = Object.keys(languages) as Lang[]
const languageLabel = (id: Lang) => `${languages[id]['language.flag']}  ${languages[id]['language.name']}`

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px 2px' }}>{title}</h2>}
      <Card style={{ overflow: 'hidden' }}>{children}</Card>
    </section>
  )
}

function Row({ title, subtitle, last, onClick, children }: {
  title: string; subtitle?: string; last?: boolean; onClick?: () => void; children?: ReactNode
}) {
  return (
    <div className={onClick ? 'adw-row' : undefined} onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', minHeight: 56,
      borderBottom: last ? 'none' : '1px solid var(--border)', cursor: onClick ? 'pointer' : 'default',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--fg-dim)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

function AccentSwatches({ accent, onPick }: { accent: string; onPick: (c: string) => void }) {
  const { t } = useLanguage()
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {ACCENT_COLORS.map(({ name, c }) => (
        <button key={c} onClick={() => onPick(c)} title={t(name)} aria-label={t(name)} style={{
          width: 24, height: 24, borderRadius: '50%', border: 'none', background: c, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        }}>{accent === c && <Check size={13} weight="bold"/>}</button>
      ))}
    </div>
  )
}

function SupportTab() {
  const { t } = useLanguage()
  const links = [
    { title: t('settings.support.github.title'), desc: t('settings.support.github.desc'), Icon: GithubLogo, url: 'https://github.com/finleyaubin/nzxt-cam-linux' },
    { title: t('settings.support.bug.title'),    desc: t('settings.support.bug.desc'),    Icon: Bug,        url: 'https://github.com/finleyaubin/nzxt-cam-linux/issues/new' },
    { title: t('settings.support.reddit.title'), desc: t('settings.support.reddit.desc'), Icon: ChatCircle, url: 'https://reddit.com/r/NZXT' },
  ]
  return (
    <>
      <Group>
        {links.map(({ title, desc, Icon, url }, i) => (
          <Row key={title} title={title} subtitle={desc} last={i === links.length - 1} onClick={() => window.open(url, '_blank')}>
            <Icon size={18} style={{ color: 'var(--fg-dim)' }}/>
            <CaretRight size={14} weight="bold" style={{ color: 'var(--fg-dim)' }}/>
          </Row>
        ))}
      </Group>
      <div style={{ fontSize: 12, color: 'var(--fg-dim)', textAlign: 'center' }}>
        NZXT CAM · Linux Edition · v1.0.0 · Tauri 2
      </div>
    </>
  )
}

type Page = 'general' | SettingsPage | 'profiles' | 'support'

const PAGES: { id: Page; label: TranslationKey; Icon: Icon }[] = [
  { id: 'general',      label: 'settings.tab.general',         Icon: SlidersHorizontal },
  { id: 'monitoring',   label: 'nav.monitoring',               Icon: Pulse },
  { id: 'sensors',      label: 'settings.sensors.title',       Icon: Thermometer },
  { id: 'integrations', label: 'settings.page.integrations',   Icon: PlugsConnected },
  { id: 'devices',      label: 'settings.page.devices',         Icon: Drop },
  { id: 'profiles',     label: 'settings.tab.profiles',        Icon: Stack },
  { id: 'support',      label: 'settings.tab.support',         Icon: Lifebuoy },
]

export function SettingsScreen() {
  const { state, dispatch } = useApp()
  const { t, lang, setLang } = useLanguage()
  const { accent, compact, tempUnit } = state
  const [page, setPage] = useState<Page>('general')
  const [autostart, setAutostart] = useState(false)

  useEffect(() => {
    api.getAutostart().then(setAutostart).catch(() => {})
  }, [])

  const toggleAutostart = async (val: boolean) => {
    try {
      await api.setAutostart(val)
      setAutostart(val)
    } catch (e) {
      console.error('Autostart error:', e)
    }
  }

  const labelToLang = Object.fromEntries(languageIds.map(id => [languageLabel(id), id]))

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)' }}>
      <nav style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', boxShadow: '1px 0 0 var(--border)' }}>
        {PAGES.map(({ id, label, Icon }) => (
          <button key={id} className={page === id ? undefined : 'adw-row'} onClick={() => setPage(id)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
            background: page === id ? 'var(--selected)' : 'transparent', fontWeight: page === id ? 700 : 400,
          }}>
            <Icon size={17} weight={page === id ? 'fill' : 'regular'} style={{ flexShrink: 0 }}/>
            {t(label)}
          </button>
        ))}
      </nav>

      <div style={{ overflowY: 'auto' }}>
        <div style={{ maxWidth: 1040, padding: '24px 28px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t(PAGES.find(p => p.id === page)!.label)}</h1>

          {page === 'general' && (
            <Group>
              <Row title={t('settings.accent_color')}>
                <AccentSwatches accent={accent} onPick={c => dispatch({ type: 'SET_ACCENT', payload: c })}/>
              </Row>
              <Row title={t('settings.temperature_unit')}>
                <SegmentedControl value={tempUnit} options={['°C', '°F'] as const} onChange={u => dispatch({ type: 'SET_TEMP_UNIT', payload: u })}/>
              </Row>
              <Row title={t('settings.language')}>
                <Dropdown width={200} value={languageLabel(lang)} options={languageIds.map(languageLabel)} onChange={label => setLang(labelToLang[label])}/>
              </Row>
              <Row title={t('settings.compact_sidebar.title')} subtitle={t('settings.compact_sidebar.desc')}>
                <ToggleSwitch on={compact} onChange={v => dispatch({ type: 'SET_COMPACT', payload: v })} color={accent}/>
              </Row>
              <Row last title={t('settings.autostart.title')} subtitle={autostart ? t('settings.autostart.on') : t('settings.autostart.off')}>
                <ToggleSwitch on={autostart} onChange={toggleAutostart} color={accent}/>
              </Row>
            </Group>
          )}

          {page !== 'general' && page !== 'profiles' && page !== 'support' && <Settings page={page}/>}
          {page === 'profiles' && <Card style={{ padding: 20 }}><ProfileManager/></Card>}
          {page === 'support' && <SupportTab/>}
        </div>
      </div>
    </div>
  )
}
