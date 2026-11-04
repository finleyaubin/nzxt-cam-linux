import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import { useLanguage } from '../../i18n/LangContext'
import type { TranslationKey } from '../../i18n/languages'
import { Card } from '../ui/Card'
import { Dropdown } from '../ui/Dropdown'
import { Slider } from '../ui/Slider'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { api, RingMode, RingChannel, RingSpeed } from '../../lib/api'
import { Fan, Sun, Play } from '@phosphor-icons/react'

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)]
}

const RING_MODES: { id: string; label: TranslationKey; hasColor: boolean; hasSpeed: boolean }[] = [
  { id: 'off',          label: 'lighting.mode.off',          hasColor: false, hasSpeed: false },
  { id: 'fixed',        label: 'lighting.mode.fixed',         hasColor: true,  hasSpeed: false },
  { id: 'breathing',    label: 'lighting.mode.breathing',     hasColor: true,  hasSpeed: true  },
  { id: 'pulse',        label: 'lighting.mode.pulse',         hasColor: true,  hasSpeed: true  },
  { id: 'spectrumWave', label: 'lighting.mode.spectrumWave',       hasColor: false, hasSpeed: true  },
  { id: 'rainbowFlow',  label: 'lighting.mode.rainbowFlow',  hasColor: false, hasSpeed: true  },
  { id: 'rainbowPulse', label: 'lighting.mode.rainbowPulse', hasColor: false, hasSpeed: true  },
  { id: 'superRainbow', label: 'lighting.mode.superRainbow', hasColor: false, hasSpeed: true  },
  { id: 'marquee',      label: 'lighting.mode.marquee',       hasColor: true,  hasSpeed: true  },
]

const SPEEDS: { id: RingSpeed; label: TranslationKey }[] = [
  { id: 'slowest', label: 'lighting.speed.slowest' }, { id: 'slower', label: 'lighting.speed.slower' },
  { id: 'normal',  label: 'lighting.speed.normal'   }, { id: 'faster', label: 'lighting.speed.faster'  },
  { id: 'fastest', label: 'lighting.speed.fastest'      },
]

const CHANNELS: { id: RingChannel; label: TranslationKey; hint: TranslationKey }[] = [
  { id: 'ch01', label: 'lighting.channel.ring',     hint: 'lighting.channel.ring_hint' },
  { id: 'ch02', label: 'lighting.channel.fans',         hint: 'lighting.channel.fans_hint'  },
  { id: 'ch07', label: 'lighting.channel.all',          hint: 'lighting.channel.all_hint'       },
]

const SWATCHES = ['#9d4edd', '#00e87a', '#ff4757', '#ffb347', '#00bcd4', '#ff6b9d', '#ffffff', '#00d4ff']

// Ring around LCD visualization
function RingIcon({ color, size = 42 }: { color: string; size?: number }) {
  const cx = size / 2, r = size / 2 - 4
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r - 4} fill="#111" stroke="#1a1a1a" strokeWidth="1"/>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="5" opacity="0.18"/>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="2.5"
        style={{ filter: `drop-shadow(0 0 5px ${color})` }}/>
      <circle cx={cx} cy={cx} r={r - 10} fill="#0a0a0a" stroke="#222" strokeWidth="1"/>
      <text x={cx} y={cx + 3} textAnchor="middle" fill="#333" fontSize="6" fontFamily="Manrope,sans-serif" fontWeight="700">LCD</text>
    </svg>
  )
}

// Spinning fan
function FanIcon({ color, size = 42 }: { color: string; size?: number }) {
  return (
    <>
      <style>{`@keyframes fan-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <div style={{
        width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fan-spin 1.4s linear infinite', transformOrigin: '50% 50%',
        filter: `drop-shadow(0 0 3px ${color}88)`,
      }}>
        <Fan size={Math.round(size * 0.6)} weight="fill" color={color} />
      </div>
    </>
  )
}

function ColorSwatch({ color, selected, onSelect }: { color: string; selected: boolean; onSelect: (c: string) => void }) {
  return (
    <div onClick={() => onSelect(color)} style={{
      width: 22, height: 22, borderRadius: 8, background: color, cursor: 'pointer',
      border: `2px solid ${selected ? '#fff' : 'transparent'}`,
      boxShadow: selected ? `0 0 8px ${color}` : 'none',
      transition: 'all 140ms',
    }}/>
  )
}

function BrightnessRow({ value, onChange, accent }: { value: number; onChange: (v: number) => void; accent: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', border: '1px solid #444' }}/>
      <div style={{ flex: 1 }}><Slider value={value} min={0} max={100} onChange={onChange} color={accent}/></div>
      <Sun size={14} weight="regular" color="#7f7f7f" />
    </div>
  )
}

function RingDeviceRow({ name, sub, isFan, accent }: {
  name: TranslationKey; sub: TranslationKey; isFan?: boolean; accent: string
}) {
  const { state } = useApp()
  const { t } = useLanguage()
  const connected = state.deviceStatus.connected

  const [channel, setChannel] = useState<RingChannel>(isFan ? 'ch02' : 'ch01')
  const [effect, setEffect] = useState('fixed')
  const [color, setColor] = useState(accent)
  const [brightness, setBrightness] = useState(80)
  const [speed, setSpeed] = useState<RingSpeed>('normal')
  const [sync, setSync] = useState(true)
  const [sending, setSending] = useState(false)
  const [lastApplied, setLastApplied] = useState(false)

  const modeDef = RING_MODES.find(m => m.id === effect)!

  const buildMode = (): RingMode => {
    const [r, g, b] = hexToRgb(color)
    switch (effect) {
      case 'fixed':        return { mode: 'fixed', r, g, b }
      case 'breathing':    return { mode: 'breathing', r, g, b, speed }
      case 'pulse':        return { mode: 'pulse', r, g, b, speed }
      case 'spectrumWave': return { mode: 'spectrumWave', speed }
      case 'rainbowFlow':  return { mode: 'rainbowFlow', speed }
      case 'rainbowPulse': return { mode: 'rainbowPulse', speed }
      case 'superRainbow': return { mode: 'superRainbow', speed }
      case 'marquee':      return { mode: 'marquee', r, g, b, speed }
      default:             return { mode: 'off' }
    }
  }

  const handleApply = async () => {
    if (!connected || sending) return
    setSending(true)
    try {
      await api.sendRing(buildMode(), channel)
      setLastApplied(true)
      setTimeout(() => setLastApplied(false), 2000)
    } finally {
      setSending(false)
    }
  }

  const displayColor = effect === 'off' ? '#333' : modeDef.hasColor ? color : '#9d4edd'

  return (
    <div style={{ borderBottom: '1px solid #1c1c1c', paddingBottom: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        {/* Device visualization */}
        <div style={{ flexShrink: 0 }}>
          {isFan
            ? <FanIcon color={displayColor} size={42}/>
            : <RingIcon color={displayColor} size={42}/>
          }
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e8e8e8' }}>{t(name)}</div>
          <div style={{ fontSize: 10, color: '#7f7f7f', marginTop: 2 }}>{t(sub)}</div>
        </div>
        <div style={{ width: 120 }}>
          <BrightnessRow value={brightness} onChange={setBrightness} accent={accent}/>
        </div>
        <Dropdown
          value={t(CHANNELS.find(c => c.id === channel)!.label)}
          options={CHANNELS.map(c => t(c.label))}
          onChange={v => setChannel(CHANNELS.find(c => t(c.label) === v)!.id)}
          width={140} small accent={accent}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#7f7f7f' }}>{t('lighting.sync')}</span>
          <ToggleSwitch on={sync} onChange={setSync} size="sm" color={accent}/>
        </div>
      </div>

      <div style={{ paddingLeft: 56, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {RING_MODES.map(m => (
            <div key={m.id} onClick={() => setEffect(m.id)} style={{
              padding: '4px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 600,
              background: effect === m.id ? `${accent}22` : '#1c1c1c',
              color: effect === m.id ? accent : '#555',
              border: `1px solid ${effect === m.id ? `${accent}55` : '#2a2a2a'}`,
              transition: 'all 130ms',
            }}>{t(m.label)}</div>
          ))}
        </div>

        {modeDef.hasColor && (
          <div style={{ display: 'flex', gap: 8 }}>
            {SWATCHES.map(c => <ColorSwatch key={c} color={c} selected={c === color} onSelect={setColor}/>)}
          </div>
        )}

        {modeDef.hasSpeed && (
          <div style={{ display: 'flex', gap: 5 }}>
            {SPEEDS.map(s => (
              <div key={s.id} onClick={() => setSpeed(s.id)} style={{
                padding: '4px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                background: speed === s.id ? `${accent}22` : '#1c1c1c',
                color: speed === s.id ? accent : '#555',
                border: `1px solid ${speed === s.id ? `${accent}55` : '#2a2a2a'}`,
                transition: 'all 130ms',
              }}>{t(s.label)}</div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={handleApply} disabled={!connected || sending} style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: connected ? accent : '#252525', border: 'none',
            color: connected ? '#fff' : '#555',
            borderRadius: 8, padding: '6px 16px', fontSize: 12, fontWeight: 700,
            cursor: connected ? 'pointer' : 'not-allowed',
            boxShadow: connected ? `0 0 12px ${accent}44` : 'none', transition: 'all 140ms',
          }}>
            <Play size={12} weight="fill" />
            {sending ? t('common.sending') : t('common.apply')}
          </button>
          {lastApplied && <span style={{ fontSize: 11, color: '#00e87a' }}>{t('common.applied')}</span>}
          {!connected && <span style={{ fontSize: 11, color: '#ffb347' }}>{t('lighting.not_connected')}</span>}
        </div>
      </div>
    </div>
  )
}

export function LightingScreen() {
  const { state } = useApp()
  const { t } = useLanguage()
  const { accent } = state
  const [autoSync, setAutoSync] = useState(true)

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>{t('nav.lighting')}</div>

      <Card style={{ padding: '18px 20px' }} accent={accent}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#f0f0f0', letterSpacing: '-0.2px' }}>
              {state.deviceStatus.connected ? state.deviceStatus.productName : 'Kraken Elite'}
            </div>
            <div style={{ fontSize: 10, color: state.deviceStatus.connected ? '#00e87a' : '#484848', marginTop: 2 }}>
              {state.deviceStatus.connected ? t('common.connected') : t('common.not_connected')}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#9a9a9a' }}>{t('lighting.auto_sync')}</span>
            <ToggleSwitch on={autoSync} onChange={setAutoSync} color={accent}/>
          </div>
        </div>

        <RingDeviceRow name="lighting.channel.ring" sub="lighting.channel.ring_sub" isFan={false} accent={accent}/>
        <RingDeviceRow name="lighting.channel.fans" sub="lighting.channel.fans_sub"   isFan={true}  accent={accent}/>
      </Card>
    </div>
  )
}
