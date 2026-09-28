import { useState, useCallback, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { Dropdown } from '../ui/Dropdown'
import { Card } from '../ui/Card'
import { Slider } from '../ui/Slider'
import { api } from '../../lib/api'
import { useSensorSlots, BoundSensor } from '../../hooks/useSensorSlots'
import {
  DisplayConfig, DisplayElement, MetricId, BaseMetric, PRESETS, LCD_SIZE,
  makeGauge, makeBar, makeText, metricMax, isBaseMetric, genId,
} from '@shared/display'
import { Play, ImageSquare, X, Gif, Plus } from '@phosphor-icons/react'
import { GiphyPicker } from './GiphyPicker'

type VizType = 'gauge' | 'ring' | 'linear' | 'none'

const BG_COLORS   = ['#000000', '#1a1a1a', '#888888', '#ffffff']
const LOGO_COLORS = ['#ffffff', '#9d4edd', '#00e87a', '#ffb347', '#ff4757']
const VIZ_COLORS  = ['#9d4edd', '#00e87a', '#ff4757', '#ffb347', '#00bcd4', '#ff6b9d']
const NUM_COLORS  = ['#ffffff', '#9d4edd', '#00e87a', '#ffb347', '#ff4757']
const TXT_COLORS  = ['#ffffff', '#9d4edd', '#00e87a', '#ffb347', '#ff4757']
const VIZ_TYPES: { id: VizType; label: string; noun: string }[] = [
  { id: 'gauge',  label: 'Gauge',        noun: 'gauge' },
  { id: 'ring',   label: 'Ring',         noun: 'ring'  },
  { id: 'linear', label: 'Progress bar', noun: 'bar'   },
  { id: 'none',   label: 'None',         noun: ''      },
]
const BASE_READINGS: Record<BaseMetric, { label: string; unit: string }> = {
  liquid: { label: 'Liquid temperature', unit: '°'   },
  cpu:    { label: 'CPU temperature',    unit: '°'   },
  gpu:    { label: 'GPU temperature',    unit: '°'   },
  pump:   { label: 'Pump speed',         unit: 'RPM' },
}
const STORAGE_KEY = 'tempDisplaySettings'

// Concentric layout: rings step inwards, bars step down; both stop before crowding the centre number.
const RING_OUTER = 290
const RING_INNER_LIMIT = 150
const LAYER_GAP = 10
const BAR_TOP = 480
const BAR_BOTTOM_LIMIT = 590

interface Layer {
  id: string
  metric: MetricId
  color: string
}

interface Settings {
  bg:            string
  bgImage:       string | null
  bgDim:         number
  showLogo:      boolean
  logoColor:     string
  showViz:       boolean
  vizType:       VizType
  layers:        Layer[]
  barSegmented:  boolean
  thickness:     number
  corners:       number
  gradient:      boolean
  gradientColor: string
  primaryMetric: MetricId
  numberColor:   string
  textColor:     string
}

const DEFAULT: Settings = {
  bg: '#000000', bgImage: null, bgDim: 40, showLogo: true, logoColor: '#ffffff',
  showViz: true, vizType: 'gauge', layers: [],
  barSegmented: false, thickness: 40, corners: 20, gradient: false, gradientColor: '#00bcd4',
  primaryMetric: 'liquid', numberColor: '#ffffff', textColor: '#ffffff',
}

function loadSettings(): Settings {
  let stored: Partial<Settings> & { vizColor?: string } = {}
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } catch { /* corrupt or blocked storage */ }
  const s = { ...DEFAULT, ...stored }
  if (!s.layers?.length) {
    s.layers = [{ id: genId('layer'), metric: s.primaryMetric, color: stored.vizColor ?? VIZ_COLORS[0] }]
  }
  return s
}

interface Reading { id: MetricId; label: string; unit: string; max: number }

function readingFor(id: MetricId, sensors: BoundSensor[]): Reading {
  if (isBaseMetric(id)) return { id, ...BASE_READINGS[id], max: metricMax(id) }
  const bound = sensors.find(b => b.metric === id)
  return bound ? { id, label: bound.label, unit: bound.unit, max: bound.max } : { id, label: 'Removed sensor', unit: '', max: 100 }
}

const unitSuffix = (unit: string) => (unit === '°' || unit === '%' || unit === '' ? unit : ` ${unit}`)
const rangeText = (r: Reading) => `0-${r.max.toLocaleString()}${unitSuffix(r.unit)}`

/** How many layers fit at this thickness before they run into the centre text or off the round screen. */
function layerCapacity(vizType: VizType, thickness: number): number {
  const step = thickness + LAYER_GAP
  if (vizType === 'linear') return Math.max(1, Math.floor((BAR_BOTTOM_LIMIT - BAR_TOP) / step) + 1)
  return Math.max(1, Math.floor((RING_OUTER - thickness - RING_INNER_LIMIT) / step) + 1)
}

/** Widest bar that stays inside the circular LCD at this height, capped at 400px. */
function barWidthAt(y: number, height: number): number {
  const r = LCD_SIZE / 2
  const dy = Math.abs(y - r) + height / 2
  return Math.min(400, 2 * Math.sqrt(Math.max(0, r * r - dy * dy)) - 60)
}

function buildConfig(s: Settings, sensors: BoundSensor[]): DisplayConfig {
  const elements: DisplayElement[] = []
  const shared = { cornerRadius: s.corners, gradientTo: s.gradient ? s.gradientColor : null, showValue: false, showLabel: false }
  if (s.showViz && s.vizType !== 'none') {
    const step = s.thickness + LAYER_GAP
    s.layers.slice(0, layerCapacity(s.vizType, s.thickness)).forEach((layer, i) => {
      const max = readingFor(layer.metric, sensors).max
      if (s.vizType === 'linear') {
        const y = BAR_TOP + i * step
        elements.push(makeBar(layer.metric, {
          ...shared, color: layer.color, max, x: 320, y, width: barWidthAt(y, s.thickness), height: s.thickness,
          segments: s.barSegmented ? 10 : 0,
        }))
      } else {
        const ring = s.vizType === 'ring'
        elements.push(makeGauge(layer.metric, {
          ...shared, color: layer.color, max, radius: RING_OUTER - i * step, thickness: s.thickness,
          startAngle: ring ? 0 : -135, sweep: ring ? 360 : 270,
        }))
      }
    })
  }
  const primary = readingFor(s.primaryMetric, sensors)
  if (s.showLogo) elements.push(makeText('NZXT', { x: 320, y: 210, size: 40, color: s.logoColor }))
  elements.push(makeText(`{${s.primaryMetric}}${unitSuffix(primary.unit)}`, { x: 320, y: 340, size: 96, color: s.numberColor }))
  elements.push(makeText(primary.label.toUpperCase(), { x: 320, y: 420, size: 24, color: s.textColor }))
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

/** Round colour chip that opens the native picker. */
function ColorDot({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <label title={label} style={{ position: 'relative', width: 22, height: 22, flexShrink: 0, cursor: 'pointer' }}>
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: value, boxShadow: '0 0 0 2px #0d0d0d, 0 0 0 3px #2a2a2a' }}/>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} aria-label={label}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}/>
    </label>
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

function CheckRow({ label, checked, onChange, accent, children }: { label: string; checked: boolean; onChange: (v: boolean) => void; accent: string; children?: React.ReactNode }) {
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

function Pill({ active, accent, onClick, children }: { active: boolean; accent: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${active ? `${accent}55` : '#252525'}`,
      background: active ? `${accent}18` : '#111',
      color: active ? accent : '#9a9a9a',
      transition: 'all 120ms',
    }}>{children}</button>
  )
}

function LayerList({ s, readings, sensors, accent, onChange }: {
  s: Settings; readings: Reading[]; sensors: BoundSensor[]; accent: string; onChange: (layers: Layer[]) => void
}) {
  const noun = VIZ_TYPES.find(v => v.id === s.vizType)?.noun ?? 'ring'
  const capacity = layerCapacity(s.vizType, s.thickness)
  const full = s.layers.length >= capacity
  const setLayer = (id: string, patch: Partial<Layer>) => onChange(s.layers.map(l => (l.id === id ? { ...l, ...patch } : l)))

  const add = () => {
    const used = new Set(s.layers.map(l => l.metric))
    const metric = readings.find(r => !used.has(r.id))?.id ?? readings[0].id
    const color = VIZ_COLORS.find(c => !s.layers.some(l => l.color === c)) ?? VIZ_COLORS[s.layers.length % VIZ_COLORS.length]
    onChange([...s.layers, { id: genId('layer'), metric, color }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {s.layers.map((layer, i) => {
        const reading = readingFor(layer.metric, sensors)
        const fits = i < capacity
        return (
          <div key={layer.id} className="fade-up" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '5px 6px 5px 10px', borderRadius: 8,
            background: '#0f0f0f', border: '1px solid #1a1a1a', opacity: fits ? 1 : 0.45, transition: 'opacity 150ms',
          }}>
            <ColorDot value={layer.color} onChange={color => setLayer(layer.id, { color })} label={`${reading.label} colour`}/>
            <Dropdown
              value={reading.label}
              options={readings.map(r => r.label)}
              onChange={v => { const r = readings.find(o => o.label === v); if (r) setLayer(layer.id, { metric: r.id }) }}
              width={230} small accent={accent}
            />
            <span style={{ flex: 1, fontSize: 11, color: '#7f7f7f', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
              {fits ? rangeText(reading) : 'No room'}
            </span>
            <button onClick={() => onChange(s.layers.filter(l => l.id !== layer.id))} disabled={s.layers.length === 1}
              aria-label={`Remove ${reading.label} ${noun}`} style={{
                display: 'flex', padding: 7, borderRadius: 8, border: 'none', background: 'transparent',
                color: s.layers.length === 1 ? '#333' : '#7f7f7f', cursor: s.layers.length === 1 ? 'default' : 'pointer',
              }}
              onMouseEnter={e => { if (s.layers.length > 1) e.currentTarget.style.color = '#ff4757' }}
              onMouseLeave={e => { e.currentTarget.style.color = s.layers.length === 1 ? '#333' : '#7f7f7f' }}
            ><X size={13}/></button>
          </div>
        )
      })}
      <button onClick={add} disabled={full} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
        border: `1px dashed ${full ? '#1e1e1e' : '#2e2e2e'}`, background: 'transparent',
        color: full ? '#555' : '#9a9a9a', fontSize: 11, fontWeight: 600, cursor: full ? 'not-allowed' : 'pointer', transition: 'all 130ms',
      }}
      onMouseEnter={e => { if (!full) { e.currentTarget.style.borderColor = `${accent}88`; e.currentTarget.style.color = accent } }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = full ? '#1e1e1e' : '#2e2e2e'; e.currentTarget.style.color = full ? '#555' : '#9a9a9a' }}
      >
        <Plus size={12}/>
        {full ? `No room for another ${noun}. Make them thinner to fit more.` : `Add ${noun}`}
      </button>
    </div>
  )
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

export function TempDisplayConfig() {
  const { state } = useApp()
  const { accent, deviceStatus } = state
  const sensors = useSensorSlots()
  const [s, setS] = useState<Settings>(loadSettings)
  const [status, setStatus] = useState<'idle' | 'applying' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [rotation, setRotation] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)
  const [showGiphy, setShowGiphy] = useState(false)

  useEffect(() => { api.getLcdOrientation().then(setRotation) }, [])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* private storage */ }
  }, [s])

  const readings: Reading[] = [
    ...(Object.keys(BASE_READINGS) as BaseMetric[]).map(id => readingFor(id, sensors)),
    ...sensors.map(b => readingFor(b.metric, sensors)),
  ]
  const config = buildConfig(s, sensors)
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
  const primary = readingFor(s.primaryMetric, sensors)

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

            <div style={{ height: 1, background: '#1c1c1c', margin: '2px 0' }}/>

            <Row label="Centre reading">
              <Dropdown
                value={primary.label}
                options={readings.map(r => r.label)}
                onChange={v => { const r = readings.find(o => o.label === v); if (r) upd('primaryMetric', r.id) }}
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <CheckRow label="Visualisation" checked={s.showViz} onChange={v => upd('showViz', v)} accent={accent}>
                {VIZ_TYPES.map(({ id, label }) => (
                  <Pill key={id} active={s.vizType === id} accent={accent} onClick={() => upd('vizType', id)}>{label}</Pill>
                ))}
              </CheckRow>
              {s.showViz && s.vizType !== 'none' && (
                <div className="fade-up" style={{ paddingLeft: 100, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <LayerList s={s} readings={readings} sensors={sensors} accent={accent} onChange={layers => upd('layers', layers)}/>
                  {s.vizType === 'linear' && (
                    <div style={{ display: 'flex', gap: 5 }}>
                      <Pill active={!s.barSegmented} accent={accent} onClick={() => upd('barSegmented', false)}>Solid</Pill>
                      <Pill active={s.barSegmented} accent={accent} onClick={() => upd('barSegmented', true)}>Segmented</Pill>
                    </div>
                  )}
                  <BarSlider label="Thickness" value={s.thickness} min={6} max={80} unit="px" accent={accent} onChange={v => upd('thickness', v)}/>
                  <BarSlider label="Corners" value={s.corners} min={0} max={40} unit="px" accent={accent} onChange={v => upd('corners', v)}/>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9a9a9a', minWidth: 62, cursor: 'pointer' }}>
                      <input type="checkbox" checked={s.gradient} onChange={e => upd('gradient', e.target.checked)} style={{ accentColor: accent }}/>
                      Gradient
                    </label>
                    <div style={{ display: 'flex', gap: 6, opacity: s.gradient ? 1 : 0.35, pointerEvents: s.gradient ? 'auto' : 'none' }}>
                      <ColorRow colors={VIZ_COLORS} value={s.gradientColor} onChange={c => upd('gradientColor', c)}/>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ height: 1, background: '#1c1c1c', margin: '2px 0' }}/>

            <Row label="Rotation">
              {[0, 90, 180, 270].map(deg => (
                <Pill key={deg} active={rotation === deg} accent={accent} onClick={() => rotate(deg)}>{deg}°</Pill>
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

      <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, position: 'sticky', top: 0 }} accent={accent}>
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
