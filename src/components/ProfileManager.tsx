import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { api, Profile, ProfileLcd, ProfileSummary } from '../lib/api'
import { Plus, Play, Trash, Copy, Check } from '@phosphor-icons/react'

const LCD_TYPE_LABEL: Record<string, string> = {
  image:        'Image',
  gif:          'GIF',
  temperatures: 'Temperatures',
  none:         'LCD unchanged',
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
  const accent = state.accent
  const [name, setName] = useState('')
  const [includeLcd, setIncludeLcd] = useState(true)
  const [includeRing, setIncludeRing] = useState(true)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(4px)' }}>
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, padding: 24, width: 340, display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#f0f0f0', letterSpacing: '-0.2px' }}>New profile</div>

        <input
          autoFocus
          placeholder="Profile name (e.g. gaming, idle…)"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim(), includeLcd, includeRing)}
          style={{
            background: '#0d0d0d', border: `1px solid ${accent}44`, borderRadius: 8,
            padding: '9px 12px', fontSize: 13, color: '#e0e0e0', outline: 'none',
            fontFamily: 'Manrope, sans-serif',
          }}
        />

        <div>
          <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700, marginBottom: 10 }}>Include in profile</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { key: 'lcd', label: 'Current LCD mode', val: includeLcd, set: setIncludeLcd },
              { key: 'ring', label: 'Current LED ring', val: includeRing, set: setIncludeRing },
            ].map(({ key, label, val, set }) => (
              <div key={key} onClick={() => set(!val)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                background: val ? `${accent}0e` : '#0d0d0d',
                border: `1px solid ${val ? `${accent}44` : '#1e1e1e'}`,
                transition: 'all 140ms',
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 8, flexShrink: 0,
                  background: val ? accent : 'transparent',
                  border: `1.5px solid ${val ? accent : '#3a3a3a'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 140ms',
                }}>
                  {val && <Check size={9} weight="regular" color="#fff" />}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: val ? '#d0d0d0' : '#555' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #222',
            background: 'transparent', color: '#9a9a9a', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 140ms',
          }}>Cancel</button>
          <button onClick={() => name.trim() && onSave(name.trim(), includeLcd, includeRing)} disabled={!name.trim()} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
            background: name.trim() ? accent : '#252525', color: name.trim() ? '#fff' : '#444',
            fontSize: 12, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'not-allowed',
            boxShadow: name.trim() ? `0 0 14px ${accent}44` : 'none', transition: 'all 140ms',
          }}>Save</button>
        </div>
      </div>
    </div>
  )
}

export function ProfileManager() {
  const { state } = useApp()
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
    if (!result.success) setError(result.error ?? 'Unknown error')
    else { flash(`"${name}" saved`); refresh() }
  }

  const handleApply = async (name: string) => {
    if (!connected || applying) return
    setApplying(name); setError(null)
    try {
      const result = await api.applyProfile(name)
      if (!result.success) setError(result.error ?? 'Error')
      else flash(`"${name}" applied`)
    } finally { setApplying(null) }
  }

  const handleDelete = async (name: string) => {
    setError(null)
    const result = await api.deleteProfile(name)
    if (!result.success) setError(result.error ?? 'Error')
    else { flash(`"${name}" deleted`); refresh() }
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
          <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', fontWeight: 700 }}>Saved profiles</div>
          <div style={{ fontSize: 11, color: '#7f7f7f', marginTop: 4 }}>Save your LCD + Ring setup in one click</div>
        </div>
        <button onClick={() => setShowSaveDialog(true)} style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '8px 16px', borderRadius: 8, border: 'none',
          background: accent, color: '#fff', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', boxShadow: `0 0 14px ${accent}44`, transition: 'all 140ms',
        }}>
          <IPlus/> New profile
        </button>
      </div>

      {/* Profile list */}
      {profiles.length === 0 ? (
        <div style={{ padding: '28px 20px', borderRadius: 12, border: '1px dashed #1e1e1e', textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: '#7f7f7f', fontWeight: 500 }}>No profiles</div>
          <div style={{ fontSize: 11, color: '#7f7f7f', marginTop: 5 }}>Create a profile to save your setup</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {profiles.map(p => (
            <div key={p.name} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px', background: '#0d0d0d',
              border: '1px solid #1a1a1a', borderRadius: 8, transition: 'border-color 140ms',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#d0d0d0', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                <div style={{ fontSize: 10, color: '#7f7f7f' }}>{LCD_TYPE_LABEL[p.lcdType] ?? p.lcdType}</div>
              </div>
              <button onClick={() => handleApply(p.name)} disabled={!connected || applying === p.name} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 8, border: `1px solid ${accent}33`,
                background: `${accent}12`, color: accent,
                fontSize: 11, fontWeight: 700, cursor: connected ? 'pointer' : 'not-allowed',
                opacity: !connected ? 0.4 : 1, transition: 'all 130ms',
              }}>
                <IPlay/>{applying === p.name ? 'Sending…' : 'Apply'}
              </button>
              <button onClick={() => handleDelete(p.name)} style={{
                width: 30, height: 30, borderRadius: 8, border: '1px solid #1e1e1e',
                background: 'transparent', color: '#7f7f7f', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 130ms',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#ff475733'; (e.currentTarget as HTMLButtonElement).style.color = '#ff4757'; (e.currentTarget as HTMLButtonElement).style.background = '#ff475712' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#1e1e1e'; (e.currentTarget as HTMLButtonElement).style.color = '#7f7f7f'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
              ><ITrash/></button>
            </div>
          ))}
        </div>
      )}

      {/* Autostart */}
      {profiles.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', fontWeight: 700, marginBottom: 8 }}>Autostart - Hyprland</div>
          <div style={{ fontSize: 11, color: '#7f7f7f', marginBottom: 10, lineHeight: 1.6 }}>
            Add to <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#7f7f7f' }}>~/.config/hypr/hyprland.conf</span> to launch a profile at startup:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {profiles.map(p => (
              <div key={p.name} onClick={() => copyCmd(p.name)} title="Click to copy" style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8,
                background: '#0a0a0a', border: `1px solid ${copied === p.name ? `${accent}44` : '#181818'}`,
                cursor: 'pointer', transition: 'all 130ms',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = '#2a2a2a'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = copied === p.name ? `${accent}44` : '#181818'}
              >
                <span style={{ color: copied === p.name ? accent : '#3a3a3a', flexShrink: 0 }}><ICopy/></span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#7f7f7f', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {autoStartCmd(p.name)}
                </span>
                {copied === p.name && <span style={{ fontSize: 10, color: accent, fontWeight: 700, flexShrink: 0 }}>Copied</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback */}
      {success && (
        <div style={{ fontSize: 11, color: '#00e87a', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Check size={12} weight="regular" />
          {success}
        </div>
      )}
      {error && (
        <div style={{ padding: '9px 13px', background: '#ff475712', border: '1px solid #ff475733', borderRadius: 8, fontSize: 11, color: '#ff4757' }}>{error}</div>
      )}

      {showSaveDialog && <SaveDialog onSave={handleSave} onCancel={() => setShowSaveDialog(false)}/>}
    </div>
  )
}
