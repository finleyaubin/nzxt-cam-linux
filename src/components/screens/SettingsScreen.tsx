import { useState, useEffect } from 'react'
import { useLanguage } from '../../i18n/LangContext'
import { useApp } from '../../context/AppContext'
import { Card } from '../ui/Card'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { Settings } from '../Settings'
import { ProfileManager } from '../ProfileManager'
import { api } from '../../lib/api'
import type { Lang } from '../../i18n/translations'
import { GithubLogo, Bug, ChatCircle, Copy, Check, CaretRight } from '@phosphor-icons/react'

const ACCENT_COLORS = [
  { name: 'Violet', c: '#9d4edd' },
  { name: 'Cyan',   c: '#00bcd4' },
  { name: 'Green',  c: '#00e87a' },
  { name: 'Gold',   c: '#ffb347' },
  { name: 'Rose',   c: '#ff6b9d' },
  { name: 'Ember',  c: '#ff4757' },
]

const WALLETS = [
  { id: 'btc', name: 'Bitcoin',  symbol: 'BTC',      color: '#f7931a', icon: '₿', address: 'bc1qxz8ctth9h296dz95v43kerhrlajfqgnt4j9umc' },
  { id: 'erc', name: 'ERC-20',   symbol: 'ETH/USDT', color: '#627eea', icon: 'Ξ', address: '0xdB6B57BE02dbb5Baa7f1013207ACEdB2E70b879c' },
  { id: 'sol', name: 'Solana',   symbol: 'SOL',      color: '#9945ff', icon: '◎', address: '7nA4q7dDXujLe6SbBX6hx91dMkwTMKcttCX1SNP1bc2v' },
]

const IGithub = () => <GithubLogo size={16} weight="fill" />
const IBug = () => <Bug size={16} weight="regular" />
const IChat = () => <ChatCircle size={16} weight="regular" />
const ICopy = () => <Copy size={13} weight="regular" />
const ICheck = () => <Check size={13} weight="regular" />

function SupportTab({ accent }: { accent: string }) {
  const { t } = useLanguage()
  const [copied, setCopied] = useState<string | null>(null)

  const SUPPORT_LINKS = [
    { title: t('support_github'), desc: t('support_github_sub'), Icon: IGithub, url: 'https://github.com/cypherxdev77/nzxt-cam-linux' },
    { title: t('support_bug'),    desc: t('support_bug_sub'),    Icon: IBug,    url: 'https://github.com/cypherxdev77/nzxt-cam-linux/issues/new' },
    { title: t('support_reddit'), desc: t('support_reddit_sub'), Icon: IChat,   url: 'https://reddit.com/r/NZXT' },
  ]

  const copyAddress = (id: string, addr: string) => {
    navigator.clipboard?.writeText(addr).catch(() => {})
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

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

      <div style={{ marginTop: 8, padding: '14px 16px', background: '#080808', borderRadius: 12, border: '1px solid #161616' }}>
        <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', fontWeight: 700, marginBottom: 12 }}>{t('support_donate_title')}</div>
        <div style={{ fontSize: 11, color: '#7f7f7f', lineHeight: 1.6, marginBottom: 12 }}>
          {t('support_donate_sub')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {WALLETS.map(({ id, name, symbol, color, icon, address }) => (
            <div key={id} style={{ background: '#0d0d0d', border: `1px solid ${color}1a`, borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: color + '18', border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color, fontWeight: 700 }}>{icon}</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#b0b0b0' }}>{name}</span>
                <span style={{ fontSize: 9, color: '#7f7f7f', background: '#1a1a1a', padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>{symbol}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111', borderRadius: 8, padding: '6px 10px', border: '1px solid #1e1e1e' }}>
                <div style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#9a9a9a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{address}</div>
                <button onClick={() => copyAddress(id, address)} style={{ background: copied === id ? color + '22' : 'transparent', border: `1px solid ${copied === id ? color + '55' : '#2a2a2a'}`, borderRadius: 8, color: copied === id ? color : '#7f7f7f', cursor: 'pointer', padding: '4px 7px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, transition: 'all 160ms', flexShrink: 0 }}>
                  {copied === id ? <><ICheck/> {t('copied')}</> : <><ICopy/> {t('copy')}</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

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
    { id: 'general',  label: t('tab_general')  },
    { id: 'profiles', label: t('tab_profiles') },
    { id: 'support',  label: t('tab_support')  },
  ]

  const LANGS: { id: Lang; label: string; flag: string }[] = [
    { id: 'en', label: 'English', flag: '🇬🇧' },
    { id: 'fr', label: 'Français', flag: '🇫🇷' },
  ]

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>Settings</div>

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
            <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 12, fontWeight: 700 }}>{t('accent_color')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {ACCENT_COLORS.map(({ name, c }) => (
                <div key={c} onClick={() => dispatch({ type: 'SET_ACCENT', payload: c })} title={name}
                  style={{ width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer', border: `2px solid ${accent === c ? '#fff' : 'transparent'}`, boxShadow: accent === c ? `0 0 10px ${c}` : 'none', transition: 'all 140ms' }}/>
              ))}
            </div>
          </div>

          {/* Temp unit */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 12, fontWeight: 700 }}>{t('temp_unit')}</div>
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
            <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 12, fontWeight: 700 }}>{t('language')}</div>
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
              <div style={{ fontSize: 13, color: '#c0c0c0', fontWeight: 500 }}>{t('compact_sidebar')}</div>
              <div style={{ fontSize: 11, color: '#7f7f7f', marginTop: 2 }}>{t('compact_sidebar_sub')}</div>
            </div>
            <ToggleSwitch on={compact} onChange={v => dispatch({ type: 'SET_COMPACT', payload: v })} color={accent}/>
          </div>

          {/* Autostart */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, padding: '14px 16px', background: '#0d0d0d', borderRadius: 8, border: `1px solid ${autostart ? `${accent}33` : '#1a1a1a'}`, transition: 'border-color 200ms' }}>
            <div>
              <div style={{ fontSize: 13, color: '#c0c0c0', fontWeight: 600, marginBottom: 3 }}>{t('autostart')}</div>
              <div style={{ fontSize: 10, color: '#7f7f7f' }}>
                {autostart ? t('autostart_on') : t('autostart_off')}
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
