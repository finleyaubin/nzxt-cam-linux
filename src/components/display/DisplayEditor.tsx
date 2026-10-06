import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { Card } from '../ui/Card'
import { api } from '../../lib/api'
import {
  DisplayConfig, DisplayElement, PRESETS, Preset, genId, makeBar, makeGauge, makeGraph, makeText, resolveText,
} from '@shared/display'
import { SceneCanvas } from './SceneCanvas'
import { ElementInspector } from './ElementInspector'
import { ScenePanel } from './ScenePanel'
import { Pill, SectionTitle } from './fields'
import { MetricOption, optionFor, useMetricOptions } from './metrics'
import { clampToScreen } from './geometry'
import {
  ArrowCounterClockwise, ChartLine, Circle, Gauge as GaugeIcon, Hash, Play, Rectangle, TextT, X,
} from '@phosphor-icons/react'

type AddKind = 'ring' | 'gauge' | 'bar' | 'graph' | 'value' | 'label'

const ADD_BUTTONS: { kind: AddKind; label: string; Icon: typeof Circle }[] = [
  { kind: 'ring',  label: 'Ring',  Icon: Circle },
  { kind: 'gauge', label: 'Gauge', Icon: GaugeIcon },
  { kind: 'bar',   label: 'Bar',   Icon: Rectangle },
  { kind: 'graph', label: 'Graph', Icon: ChartLine },
  { kind: 'value', label: 'Value', Icon: Hash },
  { kind: 'label', label: 'Label', Icon: TextT },
]

const MAX_UNDO = 100
const COALESCE_MS = 900

const unitSuffix = (unit: string) => (unit === '°' || unit === '%' || unit === '' ? unit : ` ${unit}`)

function iconFor(el: DisplayElement) {
  if (el.type === 'gauge') return el.sweep >= 360 ? Circle : GaugeIcon
  return { bar: Rectangle, graph: ChartLine, text: TextT }[el.type]
}

/** Renders the scene on the backend (same engine as the LCD), coalescing requests while the user drags. */
function useScenePreview(config: DisplayConfig | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const latest = useRef(config)
  const running = useRef(false)
  const again = useRef(false)
  latest.current = config

  const pump = useCallback(async () => {
    if (running.current) { again.current = true; return }
    running.current = true
    try {
      do {
        again.current = false
        if (!latest.current) break
        const res = await api.renderDisplayPreview(latest.current)
        if (res.success && res.dataUrl) setUrl(res.dataUrl)
      } while (again.current)
    } finally {
      running.current = false
    }
  }, [])

  const key = JSON.stringify(config)
  useEffect(() => { pump() }, [key, pump])
  // Live readings and graphs move on their own.
  useEffect(() => {
    const t = setInterval(pump, 2000)
    return () => clearInterval(t)
  }, [pump])
  return url
}

export function DisplayEditor() {
  const { state, dispatch } = useApp()
  const { accent, deviceStatus, temperatures, displayConfig: config, selectedElementId: selectedId, displayApplied } = state
  const metrics = useMetricOptions()
  const [status, setStatus] = useState<'idle' | 'applying' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const previewUrl = useScenePreview(config)

  const configRef = useRef(config)
  configRef.current = config
  const undoStack = useRef<DisplayConfig[]>([])
  const lastEdit = useRef<{ key: string; at: number } | null>(null)

  // Load the persisted scene once. An empty one gets a starter layout the user can change.
  useEffect(() => {
    if (config) return
    api.getDisplayConfig().then(cfg => {
      const saved = cfg?.elements?.length > 0
      dispatch({ type: 'SET_DISPLAY_CONFIG', payload: saved ? cfg : { ...cfg, ...PRESETS[0].build() } })
      dispatch({ type: 'SET_DISPLAY_APPLIED', payload: saved ? JSON.stringify(cfg) : null })
    })
  }, [config, dispatch])

  const setConfig = useCallback((next: DisplayConfig) => {
    dispatch({ type: 'SET_DISPLAY_CONFIG', payload: next })
    setStatus('idle')
  }, [dispatch])

  const select = useCallback((id: string | null) => dispatch({ type: 'SELECT_ELEMENT', payload: id }), [dispatch])

  /** Remember the current scene for Ctrl+Z. Edits sharing a `key` in quick succession count as one step. */
  const snapshot = useCallback((key?: string) => {
    const now = Date.now()
    const last = lastEdit.current
    lastEdit.current = key ? { key, at: now } : null
    if (key && last?.key === key && now - last.at < COALESCE_MS) return
    if (configRef.current) undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), configRef.current]
  }, [])

  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    lastEdit.current = null
    if (prev) setConfig(prev)
  }, [setConfig])

  const mapElement = useCallback((id: string, patch: Partial<DisplayElement>) => {
    const cfg = configRef.current
    if (!cfg) return
    setConfig({ ...cfg, elements: cfg.elements.map(el => (el.id === id ? ({ ...el, ...patch } as DisplayElement) : el)) })
  }, [setConfig])

  /** Inspector edit: undoable, bursts on the same field collapse into one step. */
  const editElement = useCallback((id: string, patch: Partial<DisplayElement>) => {
    snapshot(`${id}:${Object.keys(patch).join(',')}`)
    mapElement(id, patch)
  }, [snapshot, mapElement])

  const editScene = useCallback((patch: Partial<DisplayConfig>) => {
    if (!configRef.current) return
    snapshot(`scene:${Object.keys(patch).join(',')}`)
    setConfig({ ...configRef.current, ...patch })
  }, [snapshot, setConfig])

  const addElement = useCallback((kind: AddKind) => {
    const cfg = configRef.current
    if (!cfg) return
    const used = new Set(cfg.elements.flatMap(el => (el.type === 'text' ? [] : [el.metric])))
    const m: MetricOption = metrics.find(o => !used.has(o.id)) ?? metrics[0]
    const shift = (cfg.elements.length % 6) * 18
    const at = { x: 320 + shift, y: 320 + shift }
    const reading = { max: m.max, label: m.label }
    const el: DisplayElement =
      kind === 'ring'  ? makeGauge(m.id, { ...at, ...reading, radius: 130, thickness: 26, valueSize: 44 })
      : kind === 'gauge' ? makeGauge(m.id, { ...at, ...reading, radius: 130, thickness: 26, valueSize: 44, startAngle: -135, sweep: 270 })
      : kind === 'bar'   ? makeBar(m.id, { ...at, ...reading, width: 320, height: 26, valueSize: 24 })
      : kind === 'graph' ? makeGraph(m.id, { ...at, ...reading, width: 360, height: 170 })
      : kind === 'value' ? makeText(`{${m.id}}${unitSuffix(m.unit)}`, { ...at, size: 64 })
      : makeText('Label', { ...at, size: 32, color: '#9aa0b4' })
    snapshot()
    setConfig({ ...cfg, elements: [...cfg.elements, el] })
    select(el.id)
  }, [metrics, snapshot, setConfig, select])

  const removeElement = useCallback((id: string) => {
    const cfg = configRef.current
    if (!cfg) return
    snapshot()
    setConfig({ ...cfg, elements: cfg.elements.filter(el => el.id !== id) })
    select(null)
  }, [snapshot, setConfig, select])

  const duplicateElement = useCallback((id: string) => {
    const cfg = configRef.current
    const src = cfg?.elements.find(el => el.id === id)
    if (!cfg || !src) return
    const copy = { ...src, id: genId(src.type), x: clampToScreen(src.x + 20), y: clampToScreen(src.y + 20) } as DisplayElement
    snapshot()
    setConfig({ ...cfg, elements: [...cfg.elements, copy] })
    select(copy.id)
  }, [snapshot, setConfig, select])

  const reorderElement = useCallback((id: string, direction: 1 | -1) => {
    const cfg = configRef.current
    if (!cfg) return
    const from = cfg.elements.findIndex(el => el.id === id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= cfg.elements.length) return
    const elements = [...cfg.elements]
    ;[elements[from], elements[to]] = [elements[to], elements[from]]
    snapshot()
    setConfig({ ...cfg, elements })
  }, [snapshot, setConfig])

  const applyTemplate = useCallback((preset: Preset) => {
    const cfg = configRef.current
    if (!cfg) return
    const built = preset.build()
    snapshot()
    // Keep the user's background photo and settings; a template only supplies the layout and colours.
    setConfig({ ...cfg, elements: built.elements, background: cfg.backgroundImage ? cfg.background : built.background })
    select(null)
  }, [snapshot, setConfig, select])

  const resolve = useCallback(
    (text: string) => resolveText(text, temperatures, config?.decimals ?? 0),
    [temperatures, config?.decimals],
  )

  const applyToLcd = useCallback(async () => {
    const cfg = configRef.current
    if (!cfg) return
    setStatus('applying')
    setError(null)
    try {
      await api.saveDisplayConfig(cfg)
      dispatch({ type: 'SET_DISPLAY_APPLIED', payload: JSON.stringify(cfg) })
      if (deviceStatus.connected) {
        const res = await api.startTempMode()
        if (res?.success === false) throw new Error(res.error ?? 'The LCD did not accept the image')
      }
      setStatus('done')
      setTimeout(() => setStatus(s => (s === 'done' ? 'idle' : s)), 3000)
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [dispatch, deviceStatus.connected])

  // Keyboard: Delete, arrows to nudge, Ctrl+Z / Ctrl+D.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const cfg = configRef.current
      const el = cfg?.elements.find(x => x.id === selectedId)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return }
      if (!el) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeElement(el.id) }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateElement(el.id) }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        editElement(el.id, { x: clampToScreen(el.x + dx), y: clampToScreen(el.y + dy) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, undo, removeElement, duplicateElement, editElement])

  // Fit the canvas to the space available.
  const areaRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(460)
  useLayoutEffect(() => {
    const node = areaRef.current
    if (!node) return
    const measure = () => setSize(Math.max(260, Math.min(620, Math.floor(Math.min(node.clientWidth, node.clientHeight)) - 32)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [config === null])

  const titles = useMemo(() => {
    const names = new Map<string, string>()
    config?.elements.forEach(el => {
      if (el.type === 'text') names.set(el.id, `“${resolve(el.text) || '…'}”`)
      else names.set(el.id, `${el.type === 'gauge' ? (el.sweep >= 360 ? 'Ring' : 'Gauge') : el.type === 'bar' ? 'Bar' : 'Graph'} · ${el.label || optionFor(metrics, el.metric).label}`)
    })
    return names
  }, [config, metrics, resolve])

  if (!config) return <div style={{ color: '#7f7f7f', fontSize: 13, padding: 24 }}>Loading editor…</div>

  const selected = config.elements.find(el => el.id === selectedId) ?? null
  const dirty = JSON.stringify(config) !== displayApplied
  const connected = deviceStatus.connected

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 330px', gap: 16, height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0 }}>
        <div ref={areaRef} style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center' }}>
          <SceneCanvas
            config={config} previewUrl={previewUrl} selectedId={selectedId} size={size} accent={accent} resolve={resolve}
            onSelect={select} onGestureStart={() => snapshot()} onPatch={mapElement}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={applyToLcd} disabled={status === 'applying'} style={{
            display: 'flex', alignItems: 'center', gap: 7, background: accent, border: 'none', color: '#fff',
            borderRadius: 8, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            boxShadow: dirty ? `0 0 16px ${accent}55` : 'none', transition: 'all 140ms',
          }}>
            <Play size={12} weight="fill"/>
            {status === 'applying' ? 'Sending…' : status === 'done' ? (connected ? 'Applied' : 'Saved') : connected ? 'Apply to LCD' : 'Save layout'}
          </button>
          <Pill accent={accent} onClick={undo} title="Undo (Ctrl+Z)"><ArrowCounterClockwise size={13}/>Undo</Pill>
          {status === 'error' && <span style={{ fontSize: 11, color: '#ff4757' }}>{error}</span>}
          {status !== 'error' && dirty && <span style={{ fontSize: 11, color: '#ffb347' }}>Not applied yet</span>}
          {!connected && <span style={{ fontSize: 11, color: '#7f7f7f' }}>Cooler not connected, layout is saved for when it is</span>}
        </div>
      </div>

      <Card style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }} accent={accent} glow={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SectionTitle>Add to screen</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ADD_BUTTONS.map(({ kind, label, Icon }) => (
              <Pill key={kind} accent={accent} onClick={() => addElement(kind)}><Icon size={13}/>{label}</Pill>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <SectionTitle>Layers (top first)</SectionTitle>
          {config.elements.length === 0 && <div style={{ fontSize: 11, color: '#7f7f7f' }}>Nothing on the screen yet. Add something above.</div>}
          {[...config.elements].reverse().map(el => {
            const Icon = iconFor(el)
            const active = el.id === selectedId
            return (
              <div key={el.id} onClick={() => select(el.id)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px 5px 9px', borderRadius: 8, cursor: 'pointer',
                background: active ? `${accent}18` : '#0f0f0f', border: `1px solid ${active ? `${accent}55` : '#1a1a1a'}`,
                color: active ? accent : '#b8b8b8', fontSize: 12,
              }}>
                <Icon size={13} style={{ flexShrink: 0 }}/>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titles.get(el.id)}</span>
                <button onClick={e => { e.stopPropagation(); removeElement(el.id) }} aria-label="Remove" title="Remove" style={{
                  display: 'flex', padding: 4, border: 'none', background: 'transparent', color: '#7f7f7f', cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ff4757' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#7f7f7f' }}><X size={12}/></button>
              </div>
            )
          })}
        </div>

        <div style={{ height: 1, background: '#1c1c1c' }}/>

        {selected
          ? <ElementInspector
              key={selected.id} element={selected} metrics={metrics} accent={accent}
              onChange={patch => editElement(selected.id, patch)}
              onRemove={() => removeElement(selected.id)}
              onDuplicate={() => duplicateElement(selected.id)}
              onReorder={dir => reorderElement(selected.id, dir)}
            />
          : <ScenePanel config={config} accent={accent} onChange={editScene} onTemplate={applyTemplate}/>}
      </Card>
    </div>
  )
}
