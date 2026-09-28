import { useState, useCallback, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { Dropdown } from '../ui/Dropdown'
import { Card } from '../ui/Card'
import { Slider } from '../ui/Slider'
import { api } from '../../lib/api'
import {
  DisplayConfig, MetricId, METRIC_LABELS, PRESETS,
  makeGauge, makeBar, makeText,
} from '@shared/display'
import { Play, ImageSquare, X, Gif } from '@phosphor-icons/react'
import { GiphyPicker } from './GiphyPicker'

type VizType = 'gauge' | 'ring' | 'linear' | 'none'

const BG_COLORS   = ['#000000', '#1a1a1a', '#888888', '#ffffff']
const LOGO_COLORS = ['#ffffff', '#9d4edd', '#00e87a', '#ffb347', '#ff4757']
const VIZ_COLORS  = ['#9d4edd', '#00e87a', '#ff4757', '#ffb347', '#00bcd4', '#ff6b9d']
const NUM_COLORS  = ['#ffffff', '#9d4edd', '#00e87a', '#ffb347', '#ff4757']
const TXT_COLORS  = ['#ffffff', '#9d4edd', '#00e87a', '#ffb347', '#ff4757']
const VIZ_TYPES: { id: VizType; label: string }[] = [
  { id: 'gauge',  label: 'Gauge'  },
  { id: 'ring',   label: 'Ring'   },
  { id: 'linear', label: 'Progress bar' },
  { id: 'none',   label: 'None'   },
]
const BASE_METRICS: { id: MetricId; label: string }[] = [
  { id: 'liquid', label: 'Liquid temperature' },
  { id: 'cpu',    label: 'CPU temperature'    },
  { id: 'gpu',    label: 'GPU temperature'    },
  { id: 'pump',   label: 'Pump speed'         },
]
const SENSOR_SLOTS: MetricId[] = ['sensor1', 'sensor2', 'sensor3']
const STORAGE_KEY = 'tempDisplaySettings'

interface Settings {
  bg:            string
  bgImage:       string | null
  bgDim:         number
  showLogo:      boolean
  logoColor:     string
  showViz:       boolean
  vizType:       VizType
  vizColor:      string
  barSegmented:  boolean
  barThickness:  number
  barRadius:     number
  primaryMetric: MetricId
  numberColor:   string
  textColor:     string
}

const DEFAULT: Settings = {
  bg: '#000000', bgImage: null, bgDim: 40, showLogo: true, logoColor: '#ffffff',
  showViz: true, vizType: 'gauge', vizColor: '#9d4edd',
  barSegmented: false, barThickness: 34, barRadius: 17,
  primaryMetric: 'liquid', numberColor: '#ffffff', textColor: '#ffffff',
}

function loadSettings(): Settings {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  } catch {
    return DEFAULT
  }
}

function buildConfig(s: Settings, unit: string, label: string): DisplayConfig {
  const elements = []
  if (s.showViz && s.vizType !== 'none') {
    if (s.vizType === 'gauge') {
      elements.push(makeGauge(s.primaryMetric, { radius: 290, thickness: 46, color: s.vizColor, startAngle: -45, sweep: 270, showValue: false, showLabel: false }))
    } else if (s.vizType === 'ring') {
      elements.push(makeGauge(s.primaryMetric, { radius: 290, thickness: 46, color: s.vizColor, startAngle: 0, sweep: 360, showValue: false, showLabel: false }))
    } else if (s.vizType === 'linear') {
      elements.push(makeBar(s.primaryMetric, {
        x: 320, y: 500, width: 400, height: s.barThickness, color: s.vizColor,
        segments: s.barSegmented ? 10 : 0, cornerRadius: s.barRadius, showValue: false, showLabel: false,
      }))
    }
  }
  if (s.showLogo) elements.push(makeText('NZXT', { x: 320, y: 210, size: 40, color: s.logoColor }))
  elements.push(makeText(`{${s.primaryMetric}}${unit}`, { x: 320, y: 340, size: 96, color: s.numberColor }))
  elements.push(makeText(label.toUpperCase(), { x: 320, y: 420, size: 24, color: s.textColor }))
  return { background: s.bg, backgroundImage: s.bgImage, backgroundDim: s.bgDim, elements }
}

function Swatch({ color, selected, onClick }: { color: string; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={color} style={{
      width: 22, height: 22, borderRadius: 8, background: color, cursor: 'pointer', padding: 0,
      border: `2px solid ${selected ? '#fff' : 'transparent'}`,
      outline: '1px solid #2a2a2a',
      transition: 'border-color 120ms',
    }}/>
  )
}

function ColorRow({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <>
      {colors.map(c => <Swatch key={c} color={c} selected={value === c} onClick={() => onChange(c)}/>)}
      <input type="color" value={value} onChange={e => onChange(e.target.value)} title="Custom colour" style={{
        width: 22, height: 22, borderRadius: 8, border: `2px solid ${colors.includes(value) ? 'transparent' : '#fff'}`,
        padding: 0, background: 'none', cursor: 'pointer',
      }}/>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 28 }}>
      <div style={{ fontSize: 12, color: '#a0a0a0', fontWeight: 500, minWidth: 88 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>{children}</div>
    </div>
  )
}

function CheckRow({ label, checked, onChange, accent, children }: { label: string; checked: boolean; onChange: (v: boolean) => void; accent: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 28 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', minWidth: 88 }}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
          style={{ width: 14, height: 14, accentColor: accent, cursor: 'pointer' }}/>
        <span style={{ fontSize: 12, color: '#a0a0a0', fontWeight: 500 }}>{label}</span>
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', opacity: checked ? 1 : 0.35, transition: 'opacity 150ms', pointerEvents: checked ? 'auto' : 'none' }}>{children}</div>
    </div>
  )
}

function BarSlider({ label, value, min, max, unit, accent, onChange }: {
  label: string; value: number; min: number; max: number; unit: string; accent: string; onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, color: '#9a9a9a', minWidth: 62 }}>{label}</span>
      <div style={{ flex: 1, maxWidth: 200 }}><Slider value={value} min={min} max={max} onChange={onChange} color={accent}/></div>
      <span style={{ fontSize: 11, color: '#9a9a9a', fontFamily: 'JetBrains Mono, monospace', minWidth: 34 }}>{value}{unit}</span>
    </div>
  )
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

export function TempDisplayConfig() {
  const { state } = useApp()
  const { accent, deviceStatus } = state
  const [s, setS] = useState<Settings>(loadSettings)
  const [status, setStatus] = useState<'idle' | 'applying' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [rotation, setRotation] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)
  const [showGiphy, setShowGiphy] = useState(false)
  const [slotInfo, setSlotInfo] = useState<Record<string, { label: string; unit: string }>>({})

  useEffect(() => { api.getLcdOrientation().then(setRotation) }, [])

  useEffect(() => {
    Promise.all([api.getSettings(), api.listSensors()]).then(([settings, sensors]) => {
      const info: Record<string, { label: string; unit: string }> = {}
      SENSOR_SLOTS.forEach((slot, i) => {
        const bound = sensors.find(x => x.id === settings.sensorSources?.[i])
        if (bound) info[slot] = { label: bound.label, unit: bound.unit }
      })
      setSlotInfo(info)
    })
  }, [])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* private storage */ }
  }, [s])

  const metricOptions = [
    ...BASE_METRICS,
    ...SENSOR_SLOTS.map(id => ({ id, label: slotInfo[id] ? `${METRIC_LABELS[id]}: ${slotInfo[id].label}` : `${METRIC_LABELS[id]} (unbound)` })),
  ]
  const unit = s.primaryMetric === 'pump' ? 'RPM' : slotInfo[s.primaryMetric]?.unit ?? '°'
  const unitSuffix = unit === '°' || unit === '%' || unit === '' ? unit : ` ${unit}`
  const label = slotInfo[s.primaryMetric]?.label.replace(/\s*\(.*\)$/, '') ?? METRIC_LABELS[s.primaryMetric]
  const config = buildConfig(s, unitSuffix, label)
  const configKey = JSON.stringify(config)

  useEffect(() => {
    let cancelled = false
    const render = () => api.renderDisplayPreview(JSON.parse(configKey)).then(r => {
      if (!cancelled && r.success && r.dataUrl) setPreview(r.dataUrl)
    })
    const debounce = setTimeout(render, 200)
    const live = setInterval(render, 2000)
    return () => { cancelled = true; clearTimeout(debounce); clearInterval(live) }
  }, [configKey])

  const upd = <K extends keyof Settings>(k: K, v: Settings[K]) => setS(prev => ({ ...prev, [k]: v }))

  const rotate = async (deg: number) => {
    const res = await api.setLcdOrientation(deg)
    if (res.success) setRotation(deg)
  }

  const pickBackground = async () => {
    const path = await api.openFileDialog([{ name: 'Photo or GIF', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }])
    if (path) upd('bgImage', path)
  }

  const run = useCallback(async (cfg: DisplayConfig) => {
    setStatus('applying')
    setError(null)
    try {
      await api.saveDisplayConfig(cfg)
      const res = await api.startTempMode()
      if (res?.success === false) throw new Error(res.error ?? 'The LCD did not accept the image')
      setStatus('done')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const connected = deviceStatus.connected
  const isGif = s.bgImage?.toLowerCase().endsWith('.gif')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card style={{ padding: '12px 16px' }} accent={accent}>
          <div style={{ fontSize: 12, color: '#a0a0a0', fontWeight: 600, marginBottom: 10 }}>Templates</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => run(p.build())} title={`${p.description}. Applies immediately.`} style={{
                padding: '4px 11px', borderRadius: 8, border: '1px solid #252525',
                background: '#111', color: '#9a9a9a', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', transition: 'all 130ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = `${accent}55`; e.currentTarget.style.color = accent }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#252525'; e.currentTarget.style.color = '#9a9a9a' }}
              >{p.name}</button>
            ))}
          </div>
        </Card>

        <Card style={{ padding: '16px 18px' }} accent={accent}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            <Row label="Background">
              <div style={{ display: 'flex', gap: 6, opacity: s.bgImage ? 0.35 : 1, pointerEvents: s.bgImage ? 'none' : 'auto' }}>
                <ColorRow colors={BG_COLORS} value={s.bg} onChange={c => upd('bg', c)}/>
              </div>
              <button onClick={pickBackground} style={{
                display: 'flex', alignItems: 'center', gap: 6, marginLeft: 6,
                padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${s.bgImage ? `${accent}55` : '#252525'}`,
                background: s.bgImage ? `${accent}18` : '#111', color: s.bgImage ? accent : '#9a9a9a',
                maxWidth: 220,
              }}>
                <ImageSquare size={14}/>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.bgImage ? fileName(s.bgImage) : 'Photo or GIF'}
                </span>
              </button>
              <button onClick={() => setShowGiphy(v => !v)} aria-expanded={showGiphy} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${showGiphy ? `${accent}55` : '#252525'}`,
                background: showGiphy ? `${accent}18` : '#111', color: showGiphy ? accent : '#9a9a9a',
              }}>
                <Gif size={14}/>
                GIPHY
              </button>
              {s.bgImage && (
                <button onClick={() => upd('bgImage', null)} aria-label="Remove background image" style={{
                  display: 'flex', padding: 4, borderRadius: 8, border: '1px solid #252525',
                  background: 'transparent', color: '#9a9a9a', cursor: 'pointer',
                }}><X size={12}/></button>
              )}
            </Row>

            {showGiphy && (
              <div style={{ paddingLeft: 100 }}>
                <GiphyPicker accent={accent} onPick={path => { upd('bgImage', path); setShowGiphy(false) }}/>
              </div>
            )}

            {s.bgImage && (
              <Row label="Dim image">
                <div style={{ flex: 1, maxWidth: 220 }}>
                  <Slider value={s.bgDim} min={0} max={90} onChange={v => upd('bgDim', v)} color={accent}/>
                </div>
                <span style={{ fontSize: 11, color: '#9a9a9a', fontFamily: 'JetBrains Mono, monospace', minWidth: 34 }}>{s.bgDim}%</span>
              </Row>
            )}

            <CheckRow label="Logo" checked={s.showLogo} onChange={v => upd('showLogo', v)} accent={accent}>
              <ColorRow colors={LOGO_COLORS} value={s.logoColor} onChange={c => upd('logoColor', c)}/>
            </CheckRow>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <CheckRow label="Visualisation" checked={s.showViz} onChange={v => upd('showViz', v)} accent={accent}>
                <ColorRow colors={VIZ_COLORS} value={s.vizColor} onChange={c => upd('vizColor', c)}/>
              </CheckRow>
              <div style={{ paddingLeft: 100, display: 'flex', gap: 5, opacity: s.showViz ? 1 : 0.35, pointerEvents: s.showViz ? 'auto' : 'none', transition: 'opacity 150ms' }}>
                {VIZ_TYPES.map(({ id, label }) => (
                  <button key={id} onClick={() => upd('vizType', id)} style={{
                    padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${s.vizType === id ? `${accent}55` : '#252525'}`,
                    background: s.vizType === id ? `${accent}18` : '#111',
                    color: s.vizType === id ? accent : '#9a9a9a',
                    transition: 'all 120ms',
                  }}>{label}</button>
                ))}
              </div>
              {s.showViz && s.vizType === 'linear' && (
                <div style={{ paddingLeft: 100, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {[false, true].map(seg => (
                      <button key={String(seg)} onClick={() => upd('barSegmented', seg)} style={{
                        padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        border: `1px solid ${s.barSegmented === seg ? `${accent}55` : '#252525'}`,
                        background: s.barSegmented === seg ? `${accent}18` : '#111',
                        color: s.barSegmented === seg ? accent : '#9a9a9a',
                      }}>{seg ? 'Segmented' : 'Solid'}</button>
                    ))}
                  </div>
                  <BarSlider label="Thickness" value={s.barThickness} min={6} max={80} unit="px" accent={accent} onChange={v => upd('barThickness', v)}/>
                  <BarSlider label="Corners" value={s.barRadius} min={0} max={40} unit="px" accent={accent} onChange={v => upd('barRadius', v)}/>
                </div>
              )}
            </div>

            <div style={{ height: 1, background: '#1c1c1c', margin: '2px 0' }}/>

            <Row label="Reading">
              <Dropdown
                value={metricOptions.find(m => m.id === s.primaryMetric)?.label ?? s.primaryMetric}
                options={metricOptions.map(m => m.label)}
                onChange={v => { const m = metricOptions.find(o => o.label === v); if (m) upd('primaryMetric', m.id) }}
                width={280} small accent={accent}
              />
            </Row>

            <Row label="Number">
              <ColorRow colors={NUM_COLORS} value={s.numberColor} onChange={c => upd('numberColor', c)}/>
            </Row>

            <Row label="Label">
              <ColorRow colors={TXT_COLORS} value={s.textColor} onChange={c => upd('textColor', c)}/>
            </Row>

            <div style={{ height: 1, background: '#1c1c1c', margin: '2px 0' }}/>

            <Row label="Rotation">
              {[0, 90, 180, 270].map(deg => (
                <button key={deg} onClick={() => rotate(deg)} style={{
                  padding: '4px 10px', borderRadius: 8,
                  border: `1px solid ${rotation === deg ? `${accent}55` : '#252525'}`,
                  background: rotation === deg ? `${accent}18` : '#111', color: rotation === deg ? accent : '#9a9a9a',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 130ms',
                }}>{deg}°</button>
              ))}
            </Row>
          </div>

          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => run(config)} disabled={!connected || status === 'applying'} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: connected ? accent : '#252525',
              border: 'none', color: connected ? '#fff' : '#7f7f7f',
              borderRadius: 8, padding: '8px 18px', fontSize: 12, fontWeight: 700,
              cursor: connected ? 'pointer' : 'not-allowed',
              transition: 'all 140ms',
            }}>
              <Play size={12} weight="fill" />
              {status === 'applying' ? 'Sending…' : status === 'done' ? 'Applied' : 'Apply to LCD'}
            </button>
            {!connected && <span style={{ fontSize: 11, color: '#ffb347' }}>Cooler not connected</span>}
            {status === 'error' && <span style={{ fontSize: 11, color: '#ff4757' }}>{error}</span>}
          </div>
        </Card>
      </div>

      <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }} accent={accent}>
        <div style={{ fontSize: 12, color: '#a0a0a0', fontWeight: 600, alignSelf: 'flex-start' }}>Preview</div>
        <div style={{ width: 220, height: 220, borderRadius: '50%', overflow: 'hidden', background: '#000', outline: '6px solid #1a1a1a' }}>
          {preview
            ? <img src={preview} alt="LCD preview" style={{ width: '100%', height: '100%', display: 'block' }}/>
            : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: 11, color: '#7f7f7f' }}>Rendering…</div>}
        </div>
        <div style={{ fontSize: 11, color: '#7f7f7f', textAlign: 'center', lineHeight: 1.5 }}>
          Rendered by the same engine as the LCD, with live values.
          {isGif && <><br/>GIFs animate on the cooler. Stats refresh every 5s.</>}
        </div>
      </Card>
    </div>
  )
}
