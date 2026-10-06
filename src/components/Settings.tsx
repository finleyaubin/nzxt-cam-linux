import { useEffect, useState, useCallback } from 'react'
import { AIO_DEVICES } from '@shared/devices'
import { api, AppSettings, GpuSource, Sensor } from '../lib/api'
import { useApp } from '../context/AppContext'
import { SensorList } from './SensorList'
import { Cpu, Clock, Monitor, Drop, Key, Eye, EyeSlash } from '@phosphor-icons/react'

const GITHUB_ISSUES_URL = 'https://github.com/cypherxdev77/nzxt-cam-linux/issues/new?template=device_support.md'

const IChip = () => <Cpu size={13} weight="regular" />
const IClock = () => <Clock size={13} weight="regular" />
const IMonitor = () => <Monitor size={13} weight="regular" />
const IDroplet = () => <Drop size={13} weight="regular" />

function SectionHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: description ? 6 : 0 }}>
        <span style={{ color: '#7f7f7f' }}>{icon}</span>
        <span style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', fontWeight: 700 }}>{title}</span>
      </div>
      {description && <div style={{ fontSize: 11, color: '#7f7f7f', lineHeight: 1.6, paddingLeft: 21 }}>{description}</div>}
    </div>
  )
}

function SensorSelect({ label, emptyLabel, value, sensors, onChange }: {
  label: string; emptyLabel: string; value: string | null; sensors: Sensor[]; onChange: (v: string | null) => void
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>{label}</span>
      <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} style={{
        padding: '8px 10px', borderRadius: 8, background: '#0d0d0d', color: '#c0c0c0',
        border: '1px solid #1e1e1e', fontSize: 12,
      }}>
        <option value="">{emptyLabel}</option>
        {sensors.map(s => <option key={s.id} value={s.id}>{s.label} [{s.unit}]</option>)}
      </select>
    </label>
  )
}

function ApiKeyField({ label, help, getKeyUrl, value, onSave, placeholder = 'Paste API key', secret = true }: {
  label: string; help: string; getKeyUrl?: string; value: string; onSave: (v: string) => void; placeholder?: string; secret?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [visible, setVisible] = useState(false)
  useEffect(() => setDraft(value), [value])
  const commit = () => { if (draft.trim() !== value) onSave(draft.trim()) }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 480 }}>
      <span style={{ fontSize: 12, color: '#a0a0a0', fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type={visible || !secret ? 'text' : 'password'} value={draft} placeholder={placeholder} autoComplete="off" spellCheck={false}
          onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }}
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#0d0d0d', color: '#e0e0e0', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}
        />
        {secret && <button type="button" onClick={() => setVisible(v => !v)} aria-label={visible ? 'Hide key' : 'Show key'} style={{
          display: 'flex', alignItems: 'center', padding: '0 10px', borderRadius: 8, border: '1px solid #2a2a2a',
          background: '#111', color: '#9a9a9a', cursor: 'pointer',
        }}>{visible ? <EyeSlash size={14}/> : <Eye size={14}/>}</button>}
      </div>
      <span style={{ fontSize: 11, color: '#7f7f7f' }}>
        {help}{' '}
        {getKeyUrl && <a href={getKeyUrl} onClick={e => { e.preventDefault(); api.openExternal(getKeyUrl) }} style={{ color: '#9a9a9a' }}>Get a key</a>}
        {value && (getKeyUrl ? ' · Saved' : 'Saved')}
      </span>
    </label>
  )
}

function Divider() {
  return <div style={{ height: 1, background: '#1a1a1a', margin: '20px 0' }}/>
}

interface NumFieldProps {
  label: string
  help?: string
  value: number
  min: number
  max: number
  step?: number
  accent: string
  onChange: (v: number) => void
}
function NumField({ label, help, value, min, max, step = 1, accent, onChange }: NumFieldProps) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => { setDraft(String(value)) }, [value])
  const commit = () => {
    setFocused(false)
    const n = parseInt(draft, 10)
    if (Number.isFinite(n)) {
      const clamped = Math.max(min, Math.min(max, n))
      onChange(clamped)
      setDraft(String(clamped))
    } else {
      setDraft(String(value))
    }
  }
  return (
    <div>
      <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {help && <div style={{ fontSize: 10, color: '#7f7f7f', marginBottom: 7, lineHeight: 1.5 }}>{help}</div>}
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#0d0d0d',
            border: `1px solid ${focused ? `${accent}55` : '#222'}`,
            borderRadius: 8, padding: '7px 10px',
            fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
            color: '#c0c0c0', outline: 'none',
            transition: 'border-color 150ms',
          }}
        />
      </div>
    </div>
  )
}

export function Settings() {
  const { state } = useApp()
  const accent = state.accent
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [gpus, setGpus] = useState<GpuSource[]>([])
  const [sensors, setSensors] = useState<Sensor[]>([])
  const [advanced, setAdvanced] = useState(false)
  const [requested, setRequested] = useState<Set<string>>(new Set())

  useEffect(() => {
    api.getSettings().then(setSettings)
    api.listGpuSources().then(setGpus)
    api.listSensors().then(setSensors)
  }, [])

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    const res = await api.saveSettings(patch)
    if (res?.settings) setSettings(res.settings)
    if ('homeAssistantUrl' in patch || 'apiKeys' in patch) api.listSensors().then(setSensors)
  }, [])

  const requestAccess = useCallback((id: string, name: string, brand: string) => {
    const params = new URLSearchParams({ title: `Device support: ${brand} ${name}` })
    api.openExternal(`${GITHUB_ISSUES_URL}&${params.toString()}`)
    setRequested(prev => new Set(prev).add(id))
  }, [])

  const brands = Array.from(new Set(AIO_DEVICES.map(d => d.brand)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Cadence */}
      <SectionHeader icon={<IClock/>} title="Polling & precision" description="Controls the sensor read frequency and LCD refresh rate."/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 4 }}>Displayed decimals</div>
          <div style={{ fontSize: 10, color: '#7f7f7f', marginBottom: 7 }}>0 = 45° · 1 = 45.3° · 2 = 45.32°</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[0, 1, 2].map(d => (
              <button key={d} onClick={() => update({ decimals: d })} style={{
                padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${(settings?.decimals ?? 0) === d ? `${accent}55` : '#222'}`,
                background: (settings?.decimals ?? 0) === d ? `${accent}18` : '#0d0d0d',
                color: (settings?.decimals ?? 0) === d ? accent : '#555',
                transition: 'all 140ms', fontFamily: 'JetBrains Mono, monospace',
              }}>{d}</button>
            ))}
          </div>
        </div>
      </div>

      <button onClick={() => setAdvanced(v => !v)} aria-expanded={advanced} style={{
        marginTop: 12, padding: 0, background: 'none', border: 'none', color: '#777', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
      }}>{advanced ? '▾' : '▸'} Advanced (refresh intervals)</button>
      {advanced && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <NumField label="Sensor read (ms)" help="Interval between CPU/GPU reads." value={settings?.pollIntervalMs ?? 1000} min={100} max={60000} step={50} accent={accent} onChange={v => update({ pollIntervalMs: v })}/>
          <NumField label="LCD render (ms)" help="Scene render frequency. USB push only happens when the image changes." value={settings?.lcdPollMs ?? 500} min={50} max={60000} step={50} accent={accent} onChange={v => update({ lcdPollMs: v })}/>
          <NumField label="LCD push cooldown (ms)" help="Minimum delay between 2 USB sends. 0 = none." value={settings?.lcdMinPushMs ?? 200} min={0} max={10000} step={50} accent={accent} onChange={v => update({ lcdMinPushMs: v })}/>
        </div>
      )}

      <Divider/>

      {/* GPU */}
      <SectionHeader icon={<IChip/>} title="GPU source" description="Select the GPU whose temperature is displayed. On systems with iGPU + dGPU, choose the correct one."/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Auto */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#0d0d0d', border: `1px solid ${!settings?.gpuSource ? `${accent}44` : '#1e1e1e'}`, borderRadius: 8, cursor: 'pointer', transition: 'all 140ms' }}>
          <input type="radio" name="gpu" checked={!settings?.gpuSource} onChange={() => update({ gpuSource: null })} style={{ accentColor: accent }}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#c0c0c0' }}>Automatic</div>
            <div style={{ fontSize: 10, color: '#7f7f7f', marginTop: 2 }}>Dedicated card if available, otherwise iGPU</div>
          </div>
        </label>
        {gpus.length === 0 && (
          <div style={{ fontSize: 11, color: '#7f7f7f', padding: '8px 14px' }}>No GPU detected via hwmon.</div>
        )}
        {gpus.map(g => (
          <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#0d0d0d', border: `1px solid ${settings?.gpuSource === g.id ? `${accent}44` : '#1e1e1e'}`, borderRadius: 8, cursor: 'pointer', transition: 'all 140ms' }}>
            <input type="radio" name="gpu" checked={settings?.gpuSource === g.id} onChange={() => update({ gpuSource: g.id })} style={{ accentColor: accent }}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#c0c0c0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.label}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#7f7f7f', marginTop: 2 }}>{g.pci}</div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: g.discrete ? `${accent}18` : '#1a1a1a', color: g.discrete ? accent : '#484848', whiteSpace: 'nowrap' }}>
              {g.discrete ? 'Dedicated' : 'iGPU'}
            </span>
          </label>
        ))}
      </div>

      <Divider/>

      {/* Sensors */}
      <SectionHeader icon={<IChip/>} title="Sensors" description="Extra readings for the LCD: temperatures, load, clocks, power, fans or memory. Set the value that fills a gauge or bar."/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ maxWidth: 360 }}>
          <SensorSelect label="CPU temperature source" emptyLabel="Automatic" value={settings?.cpuSource ?? null} sensors={sensors.filter(s => s.unit === '°')} onChange={v => update({ cpuSource: v })}/>
        </div>
        {settings && <SensorList slots={settings.sensors ?? []} catalog={sensors} accent={accent} onChange={slots => update({ sensors: slots })}/>}
      </div>

      <Divider/>

      {/* API keys */}
      <SectionHeader icon={<Key size={13}/>} title="API keys" description="Stored locally in your config file (readable only by your user)."/>
      <ApiKeyField
        label="GIPHY"
        help="Used to search GIFs for the LCD."
        getKeyUrl="https://developers.giphy.com/dashboard/"
        value={settings?.apiKeys?.giphy ?? ''}
        onSave={v => update({ apiKeys: { ...(settings?.apiKeys ?? {}), giphy: v } })}
      />

      <Divider/>

      {/* Home Assistant */}
      <SectionHeader icon={<IChip/>} title="Home Assistant" description="Show numeric Home Assistant entities (room temperature, power draw, …) on the LCD. They appear in the sensor picker."/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ApiKeyField
          label="Server URL" secret={false} placeholder="http://homeassistant.local:8123" help=""
          value={settings?.homeAssistantUrl ?? ''}
          onSave={v => update({ homeAssistantUrl: v })}
        />
        <ApiKeyField
          label="Long-lived access token" placeholder="Paste token"
          help={`Create one under your Home Assistant profile > Security.${settings?.homeAssistantUrl && settings.apiKeys?.homeassistant ? ` ${sensors.filter(s => s.id.startsWith('ha:')).length} entities found.` : ''}`}
          value={settings?.apiKeys?.homeassistant ?? ''}
          onSave={v => update({ apiKeys: { ...(settings?.apiKeys ?? {}), homeassistant: v } })}
        />
      </div>

      <Divider/>

      {/* AIO */}
      <SectionHeader icon={<IDroplet/>} title="Watercooling AIO" description="Only the NZXT Kraken Elite V2 is tested. Other models are pending hardware support."/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {brands.map(brand => (
          <div key={brand}>
            <div style={{ fontSize: 10, color: '#7f7f7f', fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase', marginBottom: 8 }}>{brand}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {AIO_DEVICES.filter(d => d.brand === brand).map(d => {
                const supported = d.status === 'supported'
                const active = settings?.selectedDevice === d.id
                return (
                  <div key={d.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 8,
                    background: supported ? '#0d0d0d' : '#090909',
                    border: `1px solid ${active ? `${accent}44` : supported ? '#1e1e1e' : '#141414'}`,
                    opacity: supported ? 1 : 0.6, transition: 'all 140ms',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#c0c0c0' }}>{d.name}</span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, letterSpacing: '0.5px',
                          background: supported ? '#00e87a18' : '#1a1a1a',
                          color: supported ? '#00e87a' : '#3a3a3a',
                        }}>{supported ? 'Supported' : 'Draft'}</span>
                        {active && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: `${accent}18`, color: accent }}>Active</span>}
                      </div>
                      <div style={{ fontSize: 10, color: '#7f7f7f' }}>Screen {d.lcd}{d.note ? ` - ${d.note}` : ''}</div>
                    </div>
                    {supported ? (
                      <button onClick={() => update({ selectedDevice: d.id })} disabled={active} style={{
                        padding: '5px 14px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700, cursor: active ? 'default' : 'pointer',
                        background: active ? `${accent}22` : accent,
                        color: active ? accent : '#fff',
                        opacity: active ? 0.7 : 1, transition: 'all 140ms',
                      }}>{active ? 'Active' : 'Select'}</button>
                    ) : (
                      <button onClick={() => requestAccess(d.id, d.name, d.brand)} style={{
                        padding: '5px 14px', borderRadius: 8, border: '1px solid #222',
                        background: 'transparent', color: '#7f7f7f', fontSize: 11, fontWeight: 600,
                        cursor: 'pointer', transition: 'all 140ms',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#3a3a3a'; (e.currentTarget as HTMLButtonElement).style.color = '#888' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#222'; (e.currentTarget as HTMLButtonElement).style.color = '#7f7f7f' }}
                      >{requested.has(d.id) ? 'Request sent' : "Request support"}</button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <Divider/>

      {/* Monitor section placeholder */}
      <SectionHeader icon={<IMonitor/>} title="Display"/>
      <div style={{ fontSize: 11, color: '#7f7f7f', fontFamily: 'JetBrains Mono, monospace', padding: '4px 0' }}>
        LCD resolution: 480 × 480 px · Interface: USB Direct · Firmware: Kraken Elite V2
      </div>
    </div>
  )
}
