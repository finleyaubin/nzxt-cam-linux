/**
 * Modèle de "scène" pour l'affichage personnalisable du LCD.
 * Partagé entre le frontend React et le backend Rust (via serde rename_all=camelCase).
 *
 * Tout est une liste d'éléments libres positionnés sur un canvas 640×640.
 * Les "layouts prédéfinis" sont des arrangements d'éléments pré-positionnés
 * (cf. PRESETS) que l'utilisateur peut ensuite déplacer / éditer librement.
 */

export const LCD_SIZE = 640

export type BaseMetric = 'cpu' | 'gpu' | 'liquid' | 'pump'
/** `sensorN` is the user's N-th sensor slot (Settings > Sensors), N = 1..MAX_SENSORS. */
export type MetricId = BaseMetric | `sensor${number}`
export type ElementType = 'gauge' | 'bar' | 'graph' | 'text' | 'image'

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg']

export const MAX_SENSORS = 8

export const BASE_METRIC_LABELS: Record<BaseMetric, string> = {
  cpu: 'CPU',
  gpu: 'GPU',
  liquid: 'Liquid',
  pump: 'Pump',
}

const BASE_METRIC_MAX: Record<BaseMetric, number> = {
  cpu: 100,
  gpu: 100,
  liquid: 60,
  pump: 3000,
}

export const isBaseMetric = (id: MetricId): id is BaseMetric => id in BASE_METRIC_LABELS
export const sensorMetric = (slot: number): MetricId => `sensor${slot + 1}`

export const metricLabel = (id: MetricId) => isBaseMetric(id) ? BASE_METRIC_LABELS[id] : `Sensor ${id.slice(6)}`
export const metricMax = (id: MetricId) => isBaseMetric(id) ? BASE_METRIC_MAX[id] : 100

/** Sensible full-scale value for a sensor unit; % is always 100. */
export function defaultMaxForUnit(unit: string): number {
  const byUnit: Record<string, number> = { '°': 100, '%': 100, rpm: 3000, W: 300, MHz: 6000, MiB: 16384, GB: 64, V: 12, A: 10 }
  return byUnit[unit] ?? 100
}

interface ElementBase {
  id: string
  type: ElementType
  x: number
  y: number
}

export interface GaugeElement extends ElementBase {
  type: 'gauge'
  metric: MetricId
  radius: number
  thickness: number
  max: number
  color: string
  trackColor: string
  startAngle: number
  sweep: number
  warnColor: string
  warnAt: number
  showValue: boolean
  showLabel: boolean
  label: string
  valueSize: number
  cornerRadius?: number
  gradientTo?: string | null
  showRange?: boolean
  rangeAngle?: number
  rangeOffset?: number
  valuePill?: boolean
}

export interface BarElement extends ElementBase {
  type: 'bar'
  metric: MetricId
  width: number
  height: number
  max: number
  color: string
  trackColor: string
  warnColor: string
  warnAt: number
  showValue: boolean
  showLabel: boolean
  label: string
  valueSize: number
  segments?: number
  cornerRadius?: number | null
  gradientTo?: string | null
}

/** Line chart of a metric's recent history, newest value at the right edge. (x, y) is the centre. */
export interface GraphElement extends ElementBase {
  type: 'graph'
  metric: MetricId
  width: number
  height: number
  max: number
  color: string
  /** Panel behind the plot. */
  trackColor: string
  warnColor: string
  warnAt: number
  showValue: boolean
  showLabel: boolean
  label: string
  valueSize: number
  /** Seconds of history across the full width. */
  windowSecs: number
  fill: boolean
  lineWidth: number
  cornerRadius: number
}

export interface TextElement extends ElementBase {
  type: 'text'
  text: string
  color: string
  size: number
  align: 'left' | 'center' | 'right'
  /** Installed font family; the scene's font when unset. */
  font?: string | null
}

/** A picture (logo, icon, photo) scaled to fit its box. */
export interface ImageElement extends ElementBase {
  type: 'image'
  width: number
  height: number
  path: string
  /** 0-100 */
  opacity: number
}

export type DisplayElement = GaugeElement | BarElement | GraphElement | TextElement | ImageElement

export interface DisplayConfig {
  background: string
  elements: DisplayElement[]
  variant?: string
  decimals?: number
  backgroundImage?: string | null
  backgroundDim?: number
  /** Installed font family for all text; the built-in font when unset. */
  font?: string | null
}

export function formatMetric(v: number, decimals = 0): string {
  const d = Math.max(0, Math.min(2, Math.floor(decimals)))
  return v.toFixed(d)
}

// --- Fabriques d'éléments (valeurs par défaut saines) ---

let idCounter = 0
export function genId(prefix = 'el'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

export const defaultWarnAt = (metric: MetricId, max: number) => metric === 'liquid' ? 50 : max * 0.85

export function makeGauge(metric: MetricId, overrides: Partial<GaugeElement> = {}): GaugeElement {
  const max = overrides.max ?? metricMax(metric)
  return {
    id: genId('gauge'),
    type: 'gauge',
    metric,
    x: LCD_SIZE / 2,
    y: LCD_SIZE / 2,
    radius: 250,
    thickness: 38,
    max,
    color: '#00e696',
    trackColor: '#1c1c2a',
    startAngle: 0,
    sweep: 360,
    warnColor: '#ff4444',
    warnAt: defaultWarnAt(metric, max),
    showValue: true,
    showLabel: true,
    label: metricLabel(metric),
    valueSize: 64,
    ...overrides
  }
}

export function makeBar(metric: MetricId, overrides: Partial<BarElement> = {}): BarElement {
  const max = overrides.max ?? metricMax(metric)
  return {
    id: genId('bar'),
    type: 'bar',
    metric,
    x: LCD_SIZE / 2,
    y: LCD_SIZE / 2,
    width: 380,
    height: 34,
    max,
    color: '#00e696',
    trackColor: '#1c1c2a',
    warnColor: '#ff4444',
    warnAt: defaultWarnAt(metric, max),
    showValue: true,
    showLabel: true,
    label: metricLabel(metric),
    valueSize: 32,
    ...overrides
  }
}

export function makeGraph(metric: MetricId, overrides: Partial<GraphElement> = {}): GraphElement {
  const max = overrides.max ?? metricMax(metric)
  return {
    id: genId('graph'),
    type: 'graph',
    metric,
    x: LCD_SIZE / 2,
    y: LCD_SIZE / 2,
    width: 400,
    height: 180,
    max,
    color: '#00e696',
    trackColor: '#14141f',
    warnColor: '#ff4444',
    warnAt: defaultWarnAt(metric, max),
    showValue: true,
    showLabel: true,
    label: metricLabel(metric),
    valueSize: 22,
    windowSecs: 60,
    fill: true,
    lineWidth: 3,
    cornerRadius: 16,
    ...overrides
  }
}

export function makeImage(path: string, overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    id: genId('image'),
    type: 'image',
    x: LCD_SIZE / 2,
    y: LCD_SIZE / 2,
    width: 160,
    height: 160,
    path,
    opacity: 100,
    ...overrides
  }
}

export function makeText(text: string, overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: genId('text'),
    type: 'text',
    text,
    x: LCD_SIZE / 2,
    y: LCD_SIZE / 2,
    color: '#ffffff',
    size: 32,
    align: 'center',
    ...overrides
  }
}

// --- Layouts prédéfinis ---

export interface Preset {
  id: string
  name: string
  description: string
  build: () => DisplayConfig
}

const BG = '#0a0a0f'

export const PRESETS: Preset[] = [
  {
    id: 'triple-rings',
    name: '3 rings',
    description: 'CPU, GPU and liquid as concentric gauges',
    build: () => ({
      background: BG,
      elements: [
        makeGauge('cpu', { radius: 296, thickness: 38, showValue: false, showLabel: false }),
        makeGauge('gpu', { radius: 240, thickness: 38, color: '#00d4ff', showValue: false, showLabel: false }),
        makeGauge('liquid', { radius: 184, thickness: 38, color: '#b478ff', showValue: false, showLabel: false }),
        makeText('CPU', { x: 320, y: 244, size: 32, color: '#9aa0b4' }),
        makeText('{cpu}°', { x: 320, y: 300, size: 64 }),
        makeText('GPU  {gpu}°', { x: 320, y: 362, size: 16, color: '#00d4ff' }),
        makeText('LIQUID  {liquid}°', { x: 320, y: 392, size: 16, color: '#b478ff' })
      ]
    })
  },
  {
    id: 'single-cpu',
    name: 'CPU only',
    description: 'One large centered gauge',
    build: () => ({
      background: BG,
      elements: [
        makeGauge('cpu', { radius: 290, thickness: 46, valueSize: 128, label: 'CPU' })
      ]
    })
  },
  {
    id: 'single-gpu',
    name: 'GPU only',
    description: 'One large centered gauge',
    build: () => ({
      background: BG,
      elements: [
        makeGauge('gpu', { radius: 290, thickness: 46, color: '#00d4ff', valueSize: 128, label: 'GPU' })
      ]
    })
  },
  {
    id: 'single-liquid',
    name: 'Liquid only',
    description: 'Liquid temperature as a large gauge',
    build: () => ({
      background: BG,
      elements: [
        makeGauge('liquid', { radius: 290, thickness: 46, color: '#b478ff', valueSize: 128, label: 'LIQUID' })
      ]
    })
  },
  {
    id: 'dual-bars',
    name: '2 bars',
    description: 'CPU and GPU as horizontal bars (CAM style)',
    build: () => ({
      background: BG,
      elements: [
        makeBar('gpu', { x: 320, y: 285, color: '#00d4ff' }),
        makeBar('cpu', { x: 320, y: 390 })
      ]
    })
  },
  {
    id: 'big-number',
    name: 'Big number',
    description: 'Just the CPU temperature, very large',
    build: () => ({
      background: BG,
      elements: [
        makeText('CPU', { x: 320, y: 200, size: 32, color: '#9aa0b4' }),
        makeText('{cpu}°', { x: 320, y: 320, size: 128 })
      ]
    })
  }
]

export function defaultConfig(): DisplayConfig {
  return PRESETS[0].build()
}

/** Variables a text element can use; `sensorN` tokens are added per bound sensor by the editor. */
export const TEXT_VARIABLES: { token: string; label: string }[] = [
  { token: '{cpu}', label: 'CPU temperature' },
  { token: '{gpu}', label: 'GPU temperature' },
  { token: '{liquid}', label: 'Liquid temperature' },
  { token: '{pump}', label: 'Pump speed' },
  { token: '{time}', label: 'Time' },
  { token: '{date}', label: 'Date' },
]

export interface Readings {
  cpu: number
  gpu: number
  liquid: number
  pumpRpm: number
  sensors?: number[]
}

/** Mirrors the backend's `resolve_text`: `{metric}`, `{metric:decimals}`, `{time}`, `{date}`; unknown tokens stay as typed. */
export function resolveText(text: string, temps: Readings, decimals = 0): string {
  return text.replace(/\{([a-z0-9]+)(?::(\d))?\}/gi, (whole, key: string, d?: string) => {
    const k = key.toLowerCase()
    const now = new Date()
    if (d == null && k === 'time') return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    if (d == null && k === 'date') return now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).replace(',', '')
    let v: number | undefined
    if (k === 'cpu') v = temps.cpu
    else if (k === 'gpu') v = temps.gpu
    else if (k === 'liquid') v = temps.liquid
    else if (k === 'pump') v = temps.pumpRpm
    else {
      const n = /^sensor([1-8])$/.exec(k)
      if (n) v = temps.sensors?.[Number(n[1]) - 1] ?? 0
    }
    return v === undefined ? whole : formatMetric(v, d != null ? parseInt(d, 10) : decimals)
  })
}
