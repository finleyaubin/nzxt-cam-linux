import { useState, useEffect } from 'react'
import { useLanguage } from '../../i18n/LangContext'
import { useApp } from '../../context/AppContext'
import { Card } from '../ui/Card'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { Settings } from '../Settings'
import { ProfileManager } from '../ProfileManager'
import { api } from '../../lib/api'
import { languages, Lang, TranslationKey } from '../../i18n/languages'
import { GithubLogo, Bug, ChatCircle, CaretRight } from '@phosphor-icons/react'

const ACCENT_COLORS: { name: TranslationKey; c: string }[] = [
  { name: 'accent.violet', c: '#9d4edd' },
  { name: 'accent.cyan',   c: '#00bcd4' },
  { name: 'accent.green',  c: '#00e87a' },
  { name: 'accent.gold',   c: '#ffb347' },
  { name: 'accent.rose',   c: '#ff6b9d' },
  { name: 'accent.ember',  c: '#ff4757' },
]

const IGithub = () => <GithubLogo size={16} weight="fill" />
const IBug = () => <Bug size={16} weight="regular" />
const IChat = () => <ChatCircle size={16} weight="regular" />

function SupportTab({ accent }: { accent: string }) {
  const { t } = useLanguage()

  const SUPPORT_LINKS = [
    { title: t('settings.support.github.title'), desc: t('settings.support.github.desc'), Icon: IGithub, url: 'https://github.com/cypherxdev77/nzxt-cam-linux' },
    { title: t('settings.support.bug.title'),    desc: t('settings.support.bug.desc'),    Icon: IBug,    url: 'https://github.com/cypherxdev77/nzxt-cam-linux/issues/new' },
    { title: t('settings.support.reddit.title'), desc: t('settings.support.reddit.desc'), Icon: IChat,   url: 'https://reddit.com/r/NZXT' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {SUPPORT_LINKS.map(({ title, desc, Icon, url }) => (
        <div key={title}
          onClick={() => window.open(url, '_blank')}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 8, cursor: 'pointer', transition: 'all 140ms' }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${accent}44`; (e.currentTarget as HTMLDivElement).style.background = '#111' }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1e1e1e'; (e.currentTarget as HTMLDivElement).style.background = '#0d0d0d' }}
        >
          <div style={{ width: 34, height: 34, borderRadius: 8, background: '#161616', border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9a9a9a', flexShrink: 0 }}>
            <Icon/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#d0d0d0', marginBottom: 2 }}>{title}</div>
            <div style={{ fontSize: 10, color: '#7f7f7f' }}>{desc}</div>
          </div>
          <CaretRight size={13} weight="regular" color="#7f7f7f" />
        </div>
      ))}

      <div style={{ padding: '10px 16px', background: '#080808', borderRadius: 8, border: '1px solid #141414' }}>
        <div style={{ fontSize: 11, color: '#7f7f7f', fontFamily: 'JetBrains Mono, monospace' }}>NZXT CAM · Linux Edition · v1.0.0</div>
        <div style={{ fontSize: 10, color: '#7f7f7f', marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>Tauri 2 · Rust · Arch Linux</div>
      </div>
    </div>
  )
}

export function SettingsScreen() {
  const { state, dispatch } = useApp()
  const { t, lang, setLang } = useLanguage()
  const { accent, compact, tempUnit } = state
  const [tab, setTab] = useState<'general' | 'profiles' | 'support'>('general')
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

  const TABS: { id: 'general' | 'profiles' | 'support'; label: string }[] = [
    { id: 'general',  label: t('settings.tab.general')  },
    { id: 'profiles', label: t('settings.tab.profiles') },
    { id: 'support',  label: t('settings.tab.support')  },
  ]

  const LANGS = (Object.keys(languages) as Lang[]).map(id => ({
    id, label: languages[id]['language.name'], flag: languages[id]['language.flag'],
  }))

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>{t('nav.settings')}</div>

      <div style={{ display: 'flex', gap: 2, background: '#0f0f0f', padding: 4, borderRadius: 8, alignSelf: 'flex-start' }}>
        {TABS.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: tab === tb.id ? '#222' : 'transparent',
            color: tab === tb.id ? '#e0e0e0' : '#484848',
            transition: 'all 140ms',
          }}>{tb.label}</button>
        ))}
      </div>

      {tab === 'general' && (
        <Card style={{ padding: 24 }} accent={accent}>
          {/* Accent color */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 12, fontWeight: 700 }}>{t('settings.accent_color')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {ACCENT_COLORS.map(({ name, c }) => (
                <div key={c} onClick={() => dispatch({ type: 'SET_ACCENT', payload: c })} title={t(name)}
                  style={{ width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer', border: `2px solid ${accent === c ? '#fff' : 'transparent'}`, boxShadow: accent === c ? `0 0 10px ${c}` : 'none', transition: 'all 140ms' }}/>
              ))}
            </div>
          </div>

          {/* Temp unit */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 12, fontWeight: 700 }}>{t('settings.temperature_unit')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['°C', '°F'] as const).map(u => (
                <button key={u} onClick={() => dispatch({ type: 'SET_TEMP_UNIT', payload: u })} style={{
                  padding: '7px 24px', borderRadius: 8, border: `1px solid ${tempUnit === u ? accent : '#2c2c2c'}`,
                  background: tempUnit === u ? `${accent}1a` : 'transparent',
                  color: tempUnit === u ? accent : '#555', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 140ms',
                }}>{u}</button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 12, fontWeight: 700 }}>{t('settings.language')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {LANGS.map(l => (
                <button key={l.id} onClick={() => setLang(l.id)} style={{
                  padding: '7px 18px', borderRadius: 8, border: `1px solid ${lang === l.id ? accent : '#2c2c2c'}`,
                  background: lang === l.id ? `${accent}1a` : 'transparent',
                  color: lang === l.id ? accent : '#555', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 140ms',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span>{l.flag}</span>
                  <span>{l.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Compact sidebar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: '#c0c0c0', fontWeight: 500 }}>{t('settings.compact_sidebar.title')}</div>
              <div style={{ fontSize: 11, color: '#7f7f7f', marginTop: 2 }}>{t('settings.compact_sidebar.desc')}</div>
            </div>
            <ToggleSwitch on={compact} onChange={v => dispatch({ type: 'SET_COMPACT', payload: v })} color={accent}/>
          </div>

          {/* Autostart */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, padding: '14px 16px', background: '#0d0d0d', borderRadius: 8, border: `1px solid ${autostart ? `${accent}33` : '#1a1a1a'}`, transition: 'border-color 200ms' }}>
            <div>
              <div style={{ fontSize: 13, color: '#c0c0c0', fontWeight: 600, marginBottom: 3 }}>{t('settings.autostart.title')}</div>
              <div style={{ fontSize: 10, color: '#7f7f7f' }}>
                {autostart ? t('settings.autostart.on') : t('settings.autostart.off')}
              </div>
            </div>
            <ToggleSwitch on={autostart} onChange={toggleAutostart} color={accent}/>
          </div>

          <div style={{ height: 1, background: '#1a1a1a', margin: '0 0 20px' }}/>
          <Settings/>
        </Card>
      )}

      {tab === 'profiles' && (
        <Card style={{ padding: 24 }} accent={accent}>
          <ProfileManager/>
        </Card>
      )}

      {tab === 'support' && (
        <Card style={{ padding: 24 }} accent={accent}>
          <SupportTab accent={accent}/>
        </Card>
      )}
    </div>
  )
}
