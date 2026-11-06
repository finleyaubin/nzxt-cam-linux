import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { api, Profile, ProfileLcd, ProfileSummary } from '../lib/api'
import { Plus, Play, Trash, Copy, Check } from '@phosphor-icons/react'
import type { TranslationKey } from '../i18n/languages'
import { useLanguage } from '../i18n/LangContext'

const LCD_TYPE_LABEL: Record<string, TranslationKey> = {
  image:        'profiles.lcd_type.image',
  gif:          'profiles.lcd_type.gif',
  temperatures: 'profiles.lcd_type.temperatures',
  none:         'profiles.lcd_type.none',
}

const IPlus = () => <Plus size={12} weight="regular" />
const IPlay = () => <Play size={11} weight="fill" />
const ITrash = () => <Trash size={12} weight="regular" />
const ICopy = () => <Copy size={11} weight="regular" />

function SaveDialog({ onSave, onCancel }: {
  onSave: (name: string, includeLcd: boolean, includeRing: boolean) => void
  onCancel: () => void
}) {
  const { state } = useApp()
  const { t } = useLanguage()
  const accent = state.accent
  const [name, setName] = useState('')
  const [includeLcd, setIncludeLcd] = useState(true)
  const [includeRing, setIncludeRing] = useState(true)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,  }}>
      <div style={{ background: 'var(--popover)', boxShadow: 'var(--shadow-popover)', borderRadius: 12, padding: 24, width: 340, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>{t('profiles.new')}</div>

        <input
          autoFocus
          placeholder={t('profiles.name_placeholder')}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim(), includeLcd, includeRing)}
          style={{
            background: 'var(--window)', border: `1px solid ${accent}44`, borderRadius: 8,
            padding: '9px 12px', fontSize: 13, color: 'var(--fg)', outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-dim)', fontWeight: 700, marginBottom: 10 }}>{t('profiles.include')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { key: 'lcd', label: t('profiles.include_lcd'), val: includeLcd, set: setIncludeLcd },
              { key: 'ring', label: t('profiles.include_ring'), val: includeRing, set: setIncludeRing },
            ].map(({ key, label, val, set }) => (
              <div key={key} onClick={() => set(!val)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                background: val ? `${accent}0e` : 'var(--window)',
                border: `1px solid ${val ? `${accent}44` : 'var(--border)'}`,
                transition: 'all 140ms',
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 8, flexShrink: 0,
                  background: val ? accent : 'transparent',
                  border: `1.5px solid ${val ? accent : 'var(--border)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 140ms',
                }}>
                  {val && <Check size={9} weight="regular" color="#fff" />}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: val ? 'var(--fg)' : 'var(--fg-dim)' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--fg-dim)', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 140ms',
          }}>{t('common.cancel')}</button>
          <button onClick={() => name.trim() && onSave(name.trim(), includeLcd, includeRing)} disabled={!name.trim()} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
            background: name.trim() ? accent : 'var(--border)', color: name.trim() ? '#fff' : 'var(--fg-dim)',
            fontSize: 12, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'not-allowed',
           transition: 'all 140ms',
          }}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  )
}

export function ProfileManager() {
  const { state } = useApp()
  const { t } = useLanguage()
  const { accent, deviceStatus } = state
  const connected = deviceStatus.connected

  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await api.listProfiles()
    setProfiles(list)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const flash = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  const handleSave = async (name: string, includeLcd: boolean, includeRing: boolean) => {
    setShowSaveDialog(false)
    setError(null)
    // The LCD is a single scene (elements plus optional photo/GIF background), saved whole.
    const lcd: ProfileLcd = includeLcd ? { type: 'temperatures' } : { type: 'none' }
    const profile: Profile = {
      name, lcd,
      ring: includeRing ? undefined : undefined,
      displayConfig: includeLcd ? state.displayConfig ?? undefined : undefined,
    }
    const result = await api.saveProfile(profile)
    if (!result.success) setError(result.error ?? t('error.unknown'))
    else { flash(t('profiles.flash_saved', { name })); refresh() }
  }

  const handleApply = async (name: string) => {
    if (!connected || applying) return
    setApplying(name); setError(null)
    try {
      const result = await api.applyProfile(name)
      if (!result.success) setError(result.error ?? t('error.generic'))
      else flash(t('profiles.flash_applied', { name }))
    } finally { setApplying(null) }
  }

  const handleDelete = async (name: string) => {
    setError(null)
    const result = await api.deleteProfile(name)
    if (!result.success) setError(result.error ?? t('error.generic'))
    else { flash(t('profiles.flash_deleted', { name })); refresh() }
  }

  const autoStartCmd = (name: string) => `exec-once = ~/.local/bin/nzxtcam --profile ${name}`

  const copyCmd = (name: string) => {
    navigator.clipboard.writeText(autoStartCmd(name)).catch(() => {})
    setCopied(name)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-dim)', fontWeight: 700 }}>{t('profiles.saved_title')}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 4 }}>{t('profiles.saved_desc')}</div>
        </div>
        <button onClick={() => setShowSaveDialog(true)} style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '8px 16px', borderRadius: 8, border: 'none',
          background: accent, color: '#fff', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', transition: 'all 140ms',
        }}>
          <IPlus/> New profile
        </button>
      </div>

      {/* Profile list */}
      {profiles.length === 0 ? (
        <div style={{ padding: '28px 20px', borderRadius: 12, border: '1px dashed var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--fg-dim)', fontWeight: 500 }}>{t('profiles.empty_title')}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 5 }}>{t('profiles.empty_desc')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {profiles.map(p => (
            <div key={p.name} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px', background: 'var(--window)',
              border: '1px solid var(--card)', borderRadius: 8, transition: 'border-color 140ms',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>{LCD_TYPE_LABEL[p.lcdType] ? t(LCD_TYPE_LABEL[p.lcdType]) : p.lcdType}</div>
              </div>
              <button onClick={() => handleApply(p.name)} disabled={!connected || applying === p.name} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 8, border: `1px solid ${accent}33`,
                background: `${accent}12`, color: accent,
                fontSize: 11, fontWeight: 700, cursor: connected ? 'pointer' : 'not-allowed',
                opacity: !connected ? 0.4 : 1, transition: 'all 130ms',
              }}>
                <IPlay/>{applying === p.name ? t('common.sending') : t('common.apply')}
              </button>
              <button onClick={() => handleDelete(p.name)} style={{
                width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--fg-dim)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 130ms',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#ff475733'; (e.currentTarget as HTMLButtonElement).style.color = '#f66151'; (e.currentTarget as HTMLButtonElement).style.background = '#ff475712' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-dim)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
              ><ITrash/></button>
            </div>
          ))}
        </div>
      )}

      {/* Autostart */}
      {profiles.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-dim)', fontWeight: 700, marginBottom: 8 }}>{t('profiles.autostart_title')}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginBottom: 10, lineHeight: 1.6 }}>
            Add to <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-dim)' }}>~/.config/hypr/hyprland.conf</span> to launch a profile at startup:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {profiles.map(p => (
              <div key={p.name} onClick={() => copyCmd(p.name)} title={t('common.click_to_copy')} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8,
                background: 'var(--window)', border: `1px solid ${copied === p.name ? `${accent}44` : 'var(--card)'}`,
                cursor: 'pointer', transition: 'all 130ms',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = copied === p.name ? `${accent}44` : 'var(--card)'}
              >
                <span style={{ color: copied === p.name ? accent : 'var(--border)', flexShrink: 0 }}><ICopy/></span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--fg-dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {autoStartCmd(p.name)}
                </span>
                {copied === p.name && <span style={{ fontSize: 11, color: accent, fontWeight: 700, flexShrink: 0 }}>{t('common.copied')}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback */}
      {success && (
        <div style={{ fontSize: 11, color: '#33d17a', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Check size={12} weight="regular" />
          {success}
        </div>
      )}
      {error && (
        <div style={{ padding: '9px 13px', background: '#ff475712', border: '1px solid #ff475733', borderRadius: 8, fontSize: 11, color: '#f66151' }}>{error}</div>
      )}

      {showSaveDialog && <SaveDialog onSave={handleSave} onCancel={() => setShowSaveDialog(false)}/>}
    </div>
  )
}
