import { useEffect, useState, useCallback } from 'react'
import { AIO_DEVICES } from '@shared/devices'
import { api, AppSettings, GpuSource, Sensor } from '../lib/api'
import { Card } from './ui/Card'
import { SegmentedControl } from './ui/SegmentedControl'
import { useApp } from '../context/AppContext'
import { PickerButton, SensorList } from './SensorList'
import { SensorDialog } from './display/SensorPicker'
import { Cpu, Clock, Monitor, Drop, Key, Eye, EyeSlash } from '@phosphor-icons/react'
import { useLanguage } from '../i18n/LangContext'

const GITHUB_ISSUES_URL = 'https://github.com/cypherxdev77/nzxt-cam-linux/issues/new?template=device_support.md'

const IChip = () => <Cpu size={13} weight="regular" />
const IClock = () => <Clock size={13} weight="regular" />
const IMonitor = () => <Monitor size={13} weight="regular" />
const IDroplet = () => <Drop size={13} weight="regular" />

function SectionHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: description ? 6 : 0 }}>
        <span style={{ color: 'var(--fg-dim)' }}>{icon}</span>
        <span style={{ fontSize: 12, color: 'var(--fg-dim)', fontWeight: 700 }}>{title}</span>
      </div>
      {description && <div style={{ fontSize: 12, color: 'var(--fg-dim)', lineHeight: 1.6, paddingLeft: 21 }}>{description}</div>}
    </div>
  )
}

function SensorSelect({ label, emptyLabel, value, sensors, accent, onChange }: {
  label: string; emptyLabel: string; value: string | null; sensors: Sensor[]; accent: string; onChange: (v: string | null) => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const current = value ? sensors.find(s => s.id === value)?.label ?? t('sensors.unavailable') : emptyLabel
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, color: 'var(--fg-dim)', fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex' }}><PickerButton label={current} onClick={() => setOpen(true)}/></div>
      {open && (
        <SensorDialog title={label} builtins={[{ id: 'cpu', label: emptyLabel, unit: '', max: 0 }]} accent={accent} onClose={() => setOpen(false)}
          only={s => sensors.some(x => x.id === s.id)} onBuiltin={() => onChange(null)}
          onSensor={async s => { onChange(s.id) }}/>
      )}
    </div>
  )
}

function ApiKeyField({ label, help, getKeyUrl, value, onSave, placeholder, secret = true }: {
  label: string; help: string; getKeyUrl?: string; value: string; onSave: (v: string) => void; placeholder?: string; secret?: boolean
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(value)
  const [visible, setVisible] = useState(false)
  useEffect(() => setDraft(value), [value])
  const commit = () => { if (draft.trim() !== value) onSave(draft.trim()) }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 480 }}>
      <span style={{ fontSize: 13, color: '#a0a0a0', fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type={visible || !secret ? 'text' : 'password'} value={draft} placeholder={placeholder ?? t('settings.api_key.placeholder')} autoComplete="off" spellCheck={false}
          onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }}
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--window)', color: 'var(--fg)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
        />
        {secret && <button type="button" onClick={() => setVisible(v => !v)} aria-label={visible ? t('settings.api_key.hide') : t('settings.api_key.show')} style={{
          display: 'flex', alignItems: 'center', padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)',
          background: 'var(--card)', color: 'var(--fg-dim)', cursor: 'pointer',
        }}>{visible ? <EyeSlash size={14}/> : <Eye size={14}/>}</button>}
      </div>
      <span style={{ fontSize: 12, color: 'var(--fg-dim)' }}>
        {help}{' '}
        {getKeyUrl && <a href={getKeyUrl} onClick={e => { e.preventDefault(); api.openExternal(getKeyUrl) }} style={{ color: 'var(--fg-dim)' }}>{t('settings.api_key.get')}</a>}
        {value && (getKeyUrl ? ` · ${t('common.saved')}` : t('common.saved'))}
      </span>
    </label>
  )
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
      <div style={{ fontSize: 13, color: 'var(--fg-dim)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {help && <div style={{ fontSize: 12, color: 'var(--fg-dim)', marginBottom: 7, lineHeight: 1.5 }}>{help}</div>}
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
            background: 'var(--window)',
            border: `1px solid ${focused ? `${accent}55` : 'var(--border)'}`,
            borderRadius: 8, padding: '7px 10px',
            fontSize: 13, fontVariantNumeric: 'tabular-nums',
            color: 'var(--fg)', outline: 'none',
            transition: 'border-color 150ms',
          }}
        />
      </div>
    </div>
  )
}

export type SettingsPage = 'monitoring' | 'sensors' | 'integrations' | 'devices'

function Panel({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null
  return <Card style={{ padding: 20 }}>{children}</Card>
}

export function Settings({ page }: { page: SettingsPage }) {
  const { state } = useApp()
  const { t } = useLanguage()
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
  const detected = AIO_DEVICES.find(d => d.pid !== null && d.pid === state.deviceStatus.pid)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel show={page === 'monitoring'}>
      {/* Cadence */}
      <SectionHeader icon={<IClock/>} title={t('settings.polling.title')} description={t('settings.polling.desc')}/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--fg-dim)', fontWeight: 600, marginBottom: 4 }}>{t('settings.decimals.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--fg-dim)', marginBottom: 7 }}>0 = 45° · 1 = 45.3° · 2 = 45.32°</div>
          <SegmentedControl value={String(settings?.decimals ?? 0)} options={['0', '1', '2']} onChange={d => update({ decimals: Number(d) })}/>
        </div>
      </div>

      <button onClick={() => setAdvanced(v => !v)} aria-expanded={advanced} style={{
        marginTop: 12, padding: 0, background: 'none', border: 'none', color: '#777', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
      }}>{advanced ? '▾' : '▸'} {t('settings.advanced')}</button>
      {advanced && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <NumField label={t('settings.interval.sensor.label')} help={t('settings.interval.sensor.help')} value={settings?.pollIntervalMs ?? 1000} min={100} max={60000} step={50} accent={accent} onChange={v => update({ pollIntervalMs: v })}/>
          <NumField label={t('settings.interval.lcd_render.label')} help={t('settings.interval.lcd_render.help')} value={settings?.lcdPollMs ?? 500} min={50} max={60000} step={50} accent={accent} onChange={v => update({ lcdPollMs: v })}/>
          <NumField label={t('settings.interval.lcd_push.label')} help={t('settings.interval.lcd_push.help')} value={settings?.lcdMinPushMs ?? 200} min={0} max={10000} step={50} accent={accent} onChange={v => update({ lcdMinPushMs: v })}/>
        </div>
      )}
      </Panel>

      <Panel show={page === 'monitoring'}>
      {/* GPU */}
      <SectionHeader icon={<IChip/>} title={t('settings.gpu.title')} description={t('settings.gpu.desc')}/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Auto */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--window)', border: `1px solid ${!settings?.gpuSource ? `${accent}44` : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', transition: 'all 140ms' }}>
          <input type="radio" name="gpu" checked={!settings?.gpuSource} onChange={() => update({ gpuSource: null })} style={{ accentColor: accent }}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{t('settings.gpu.auto')}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-dim)', marginTop: 2 }}>{t('settings.gpu.auto_desc')}</div>
          </div>
        </label>
        {gpus.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--fg-dim)', padding: '8px 14px' }}>{t('settings.gpu.none')}</div>
        )}
        {gpus.map(g => (
          <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--window)', border: `1px solid ${settings?.gpuSource === g.id ? `${accent}44` : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', transition: 'all 140ms' }}>
            <input type="radio" name="gpu" checked={settings?.gpuSource === g.id} onChange={() => update({ gpuSource: g.id })} style={{ accentColor: accent }}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.label}</div>
              <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--fg-dim)', marginTop: 2 }}>{g.pci}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: g.discrete ? `${accent}18` : 'var(--card)', color: g.discrete ? accent : 'var(--fg-dim)', whiteSpace: 'nowrap' }}>
              {g.discrete ? t('settings.gpu.dedicated') : t('settings.gpu.integrated')}
            </span>
          </label>
        ))}
      </div>
      </Panel>

      <Panel show={page === 'sensors'}>
      {/* Sensors */}
      <SectionHeader icon={<IChip/>} title={t('settings.sensors.title')} description={t('settings.sensors.desc')}/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ maxWidth: 360 }}>
          <SensorSelect label={t('settings.cpu_source')} emptyLabel={t('settings.gpu.auto')} value={settings?.cpuSource ?? null} sensors={sensors.filter(s => s.unit === '°')} accent={accent} onChange={v => update({ cpuSource: v })}/>
        </div>
        {settings && <SensorList slots={settings.sensors ?? []} catalog={sensors} accent={accent} onChange={slots => update({ sensors: slots })}/>}
      </div>
      </Panel>

      <Panel show={page === 'integrations'}>
      {/* API keys */}
      <SectionHeader icon={<Key size={13}/>} title={t('settings.api_keys.title')} description={t('settings.api_keys.desc')}/>
      <ApiKeyField
        label="GIPHY"
        help={t('settings.api_keys.giphy_help')}
        getKeyUrl="https://developers.giphy.com/dashboard/"
        value={settings?.apiKeys?.giphy ?? ''}
        onSave={v => update({ apiKeys: { ...(settings?.apiKeys ?? {}), giphy: v } })}
      />
      </Panel>

      <Panel show={page === 'integrations'}>
      {/* Home Assistant */}
      <SectionHeader icon={<IChip/>} title={t('settings.ha.title')} description={t('settings.ha.desc')}/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ApiKeyField
          label={t('settings.ha.url')} secret={false} placeholder="http://homeassistant.local:8123"
          help={settings?.homeAssistantUrl?.trim().toLowerCase().startsWith('http://') ? t('settings.ha.http_warning') : ''}
          value={settings?.homeAssistantUrl ?? ''}
          onSave={v => update({ homeAssistantUrl: v })}
        />
        <ApiKeyField
          label={t('settings.ha.token')} placeholder={t('settings.ha.token_placeholder')}
          help={`${t('settings.ha.token_help')}${settings?.homeAssistantUrl && settings.apiKeys?.homeassistant ? ` ${t('settings.ha.entities_found', { count: sensors.filter(s => s.id.startsWith('ha:')).length })}` : ''}`}
          value={settings?.apiKeys?.homeassistant ?? ''}
          onSave={v => update({ apiKeys: { ...(settings?.apiKeys ?? {}), homeassistant: v } })}
        />
      </div>
      </Panel>

      <Panel show={page === 'devices'}>
      {/* AIO */}
      <SectionHeader icon={<IDroplet/>} title={t('settings.aio.title')} description={t('settings.aio.desc')}/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {brands.map(brand => (
          <div key={brand}>
            <div style={{ fontSize: 12, color: 'var(--fg-dim)', fontWeight: 700, marginBottom: 8 }}>{brand}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 8 }}>
              {AIO_DEVICES.filter(d => d.brand === brand).map(d => {
                const supported = d.status === 'supported'
                const connected = state.deviceStatus.connected && d.pid !== null && d.pid === state.deviceStatus.pid
                return (
                  <div key={d.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 8,
                    background: supported ? 'var(--window)' : 'var(--window)',
                    border: `1px solid ${connected ? `${accent}44` : supported ? 'var(--border)' : 'var(--card)'}`,
                    opacity: supported ? 1 : 0.6, transition: 'all 140ms',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{d.name}</span>
                        <span style={{
                          fontSize: 12, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                          background: supported ? '#00e87a18' : 'var(--card)',
                          color: supported ? '#33d17a' : 'var(--border)',
                        }}>{supported ? t('settings.aio.supported') : t('settings.aio.draft')}</span>
                        {connected && <span style={{ fontSize: 12, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: `${accent}18`, color: accent }}>{t('settings.aio.connected')}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--fg-dim)' }}>{t('settings.aio.screen', { lcd: d.lcd })}{d.noteKey ? ` - ${t(d.noteKey)}` : ''}</div>
                    </div>
                    {!supported && (
                      <button onClick={() => requestAccess(d.id, d.name, d.brand)} style={{
                        padding: '5px 14px', borderRadius: 8, border: '1px solid var(--border)',
                        background: 'transparent', color: 'var(--fg-dim)', fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', transition: 'all 140ms',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-dim)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-dim)' }}
                      >{requested.has(d.id) ? t('settings.aio.request_sent') : t('settings.aio.request_support')}</button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      </Panel>

      <Panel show={page === 'devices'}>
      {/* Monitor section placeholder */}
      <SectionHeader icon={<IMonitor/>} title={t('settings.display.title')}/>
      <div style={{ fontSize: 12, color: 'var(--fg-dim)', fontVariantNumeric: 'tabular-nums', padding: '4px 0' }}>
        {t('settings.display.info', {
          resolution: detected ? detected.lcd.replace('×', ' × ') : '-',
          device: state.deviceStatus.connected ? state.deviceStatus.productName : t('settings.display.not_connected'),
        })}
      </div>
      </Panel>
    </div>
  )
}
