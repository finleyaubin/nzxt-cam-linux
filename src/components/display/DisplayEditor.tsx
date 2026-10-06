import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { Card } from '../ui/Card'
import { api } from '../../lib/api'
import {
  DisplayConfig, DisplayElement, IMAGE_EXTENSIONS, genId, makeBar, makeGauge, makeGraph, makeImage, makeText, resolveText,
} from '@shared/display'
import { SceneCanvas } from './SceneCanvas'
import { ElementInspector } from './ElementInspector'
import { ScenePanel } from './ScenePanel'
import { FirstRunPicker } from './FirstRunPicker'
import { Pill, SectionTitle } from './fields'
import { MetricOption, optionFor, useMetricOptions } from './metrics'
import { AlignMode, alignPatches, clampToScreen } from './geometry'
import {
  ArrowCounterClockwise, ArrowClockwise, ArrowUUpLeft, ChartLine, Circle, Gauge as GaugeIcon, Hash, ImageSquare, Play, Rectangle, TextT, X,
} from '@phosphor-icons/react'

type AddKind = 'ring' | 'gauge' | 'bar' | 'graph' | 'value' | 'label' | 'image'

const ADD_BUTTONS: { kind: AddKind; label: string; Icon: typeof Circle }[] = [
  { kind: 'ring',  label: 'Ring',  Icon: Circle },
  { kind: 'gauge', label: 'Gauge', Icon: GaugeIcon },
  { kind: 'bar',   label: 'Bar',   Icon: Rectangle },
  { kind: 'graph', label: 'Graph', Icon: ChartLine },
  { kind: 'value', label: 'Value', Icon: Hash },
  { kind: 'label', label: 'Label', Icon: TextT },
  { kind: 'image', label: 'Image', Icon: ImageSquare },
]

const ALIGN_BUTTONS: { mode: AlignMode; label: string }[] = [
  { mode: 'left', label: 'Align left' }, { mode: 'hcenter', label: 'Align centre' }, { mode: 'right', label: 'Align right' },
  { mode: 'top', label: 'Align top' }, { mode: 'vcenter', label: 'Align middle' }, { mode: 'bottom', label: 'Align bottom' },
  { mode: 'hdist', label: 'Distribute horizontally' }, { mode: 'vdist', label: 'Distribute vertically' },
]
const ALIGN_SHORT: Record<AlignMode, string> = {
  left: 'L', hcenter: 'C', right: 'R', top: 'T', vcenter: 'M', bottom: 'B', hdist: 'H↔', vdist: 'V↕',
}
const LIVE_KEY = 'nzxt.display.liveApply'
const LIVE_DELAY_MS = 1500

const MAX_UNDO = 100
const COALESCE_MS = 900

const unitSuffix = (unit: string) => (unit === '°' || unit === '%' || unit === '' ? unit : ` ${unit}`)

function iconFor(el: DisplayElement) {
  if (el.type === 'gauge') return el.sweep >= 360 ? Circle : GaugeIcon
  return { bar: Rectangle, graph: ChartLine, text: TextT, image: ImageSquare }[el.type]
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
  const redoStack = useRef<DisplayConfig[]>([])
  const [extraIds, setExtraIds] = useState<string[]>([])
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [live, setLive] = useState(() => {
    try { return localStorage.getItem(LIVE_KEY) === '1' } catch { return false }
  })
  const lastEdit = useRef<{ key: string; at: number } | null>(null)
  const [firstRun, setFirstRun] = useState(false)

  // Load the persisted scene once. An empty one gets a starter layout the user can change.
  useEffect(() => {
    if (config) return
    api.getDisplayConfig().then(cfg => {
      const saved = cfg?.elements?.length > 0
      // Nothing saved yet: start empty and offer the 'pick a look' overlay.
      if (!saved) setFirstRun(true)
      dispatch({ type: 'SET_DISPLAY_CONFIG', payload: cfg })
      dispatch({ type: 'SET_DISPLAY_APPLIED', payload: saved ? JSON.stringify(cfg) : null })
    })
  }, [config, dispatch])

  const setConfig = useCallback((next: DisplayConfig) => {
    dispatch({ type: 'SET_DISPLAY_CONFIG', payload: next })
    setStatus('idle')
  }, [dispatch])

  const select = useCallback((id: string | null, additive = false) => {
    if (!additive || !id) {
      setExtraIds([])
      dispatch({ type: 'SELECT_ELEMENT', payload: id })
      return
    }
    // Shift-click toggles membership; the first id stays primary (the inspector's element).
    const all = [...(selectedId ? [selectedId] : []), ...extraIds]
    const next = all.includes(id) ? all.filter(x => x !== id) : [...all, id]
    setExtraIds(next.slice(1))
    dispatch({ type: 'SELECT_ELEMENT', payload: next[0] ?? null })
  }, [dispatch, selectedId, extraIds])

  /** Remember the current scene for Ctrl+Z. Edits sharing a `key` in quick succession count as one step. */
  const snapshot = useCallback((key?: string) => {
    const now = Date.now()
    redoStack.current = []
    const last = lastEdit.current
    lastEdit.current = key ? { key, at: now } : null
    if (key && last?.key === key && now - last.at < COALESCE_MS) return
    if (configRef.current) undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), configRef.current]
  }, [])

  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    lastEdit.current = null
    if (prev) {
      if (configRef.current) redoStack.current.push(configRef.current)
      setConfig(prev)
    }
  }, [setConfig])

  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    lastEdit.current = null
    if (next) {
      if (configRef.current) undoStack.current.push(configRef.current)
      setConfig(next)
    }
  }, [setConfig])

  const revert = useCallback(() => {
    const applied = displayApplied
    if (!applied) return
    try {
      const prev = JSON.parse(applied) as DisplayConfig
      if (configRef.current) undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), configRef.current]
      redoStack.current = []
      lastEdit.current = null
      setConfig(prev)
    } catch { /* unreadable snapshot: leave the scene alone */ }
  }, [displayApplied, setConfig])

  const mapElement = useCallback((id: string, patch: Partial<DisplayElement>) => {
    const cfg = configRef.current
    if (!cfg) return
    setConfig({ ...cfg, elements: cfg.elements.map(el => (el.id === id ? ({ ...el, ...patch } as DisplayElement) : el)) })
  }, [setConfig])

  const mapMany = useCallback((patches: { id: string; patch: Partial<DisplayElement> }[]) => {
    const cfg = configRef.current
    if (!cfg) return
    const by = new Map(patches.map(p => [p.id, p.patch]))
    setConfig({ ...cfg, elements: cfg.elements.map(el => (by.has(el.id) ? ({ ...el, ...by.get(el.id) } as DisplayElement) : el)) })
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

  const addElement = useCallback((kind: Exclude<AddKind, 'image'>, where?: { x: number; y: number }) => {
    const cfg = configRef.current
    if (!cfg) return
    const used = new Set(cfg.elements.flatMap(el => (el.type === 'text' || el.type === 'image' ? [] : [el.metric])))
    const m: MetricOption = metrics.find(o => !used.has(o.id)) ?? metrics[0]
    const shift = (cfg.elements.length % 6) * 18
    const at = where ?? { x: 320 + shift, y: 320 + shift }
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

  const addImage = useCallback(async (where?: { x: number; y: number }) => {
    const path = await api.openFileDialog([{ name: 'Image', extensions: IMAGE_EXTENSIONS }])
    const cfg = configRef.current
    if (!path || !cfg) return
    const shift = (cfg.elements.length % 6) * 18
    const el = makeImage(path, where ?? { x: 320 + shift, y: 320 + shift })
    snapshot()
    setConfig({ ...cfg, elements: [...cfg.elements, el] })
    select(el.id)
  }, [snapshot, setConfig, select])

  const addKind = (kind: AddKind, where?: { x: number; y: number }) => (kind === 'image' ? addImage(where) : addElement(kind, where))

  const removeElement = useCallback((id: string, ids: string[] = [id]) => {
    const cfg = configRef.current
    if (!cfg) return
    snapshot()
    setConfig({ ...cfg, elements: cfg.elements.filter(el => !ids.includes(el.id)) })
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

  const alignSelection = useCallback((mode: AlignMode) => {
    const cfg = configRef.current
    if (!cfg) return
    const ids = [...(selectedId ? [selectedId] : []), ...extraIds]
    const patches = alignPatches(cfg.elements.filter(el => ids.includes(el.id)), mode,
      t => resolveText(t, temperatures, cfg.decimals ?? 0))
    if (!patches.length) return
    snapshot()
    mapMany(patches.map(({ id, ...patch }) => ({ id, patch })))
  }, [selectedId, extraIds, temperatures, snapshot, mapMany])

  const applyLayout = useCallback((built: DisplayConfig) => {
    const cfg = configRef.current
    if (!cfg) return
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
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) { e.preventDefault(); redo(); return }
      if (mod && k === 'z') { e.preventDefault(); undo(); return }
      if (!el) return
      const group = [el.id, ...extraIds]
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeElement(el.id, group) }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateElement(el.id) }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (group.length === 1) editElement(el.id, { x: clampToScreen(el.x + dx), y: clampToScreen(el.y + dy) })
        else {
          snapshot('nudge')
          mapMany((configRef.current?.elements ?? []).filter(x => group.includes(x.id))
            .map(x => ({ id: x.id, patch: { x: clampToScreen(x.x + dx), y: clampToScreen(x.y + dy) } })))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, extraIds, undo, redo, removeElement, duplicateElement, editElement, snapshot, mapMany])

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

  const toggleLive = () => {
    const next = !live
    setLive(next)
    try { localStorage.setItem(LIVE_KEY, next ? '1' : '0') } catch { /* storage unavailable */ }
  }

  // "Apply as I edit": once edits settle, push the scene to the cooler.
  const applyRef = useRef(applyToLcd)
  applyRef.current = applyToLcd
  const configKey = config ? JSON.stringify(config) : ''
  useEffect(() => {
    if (!live || !deviceStatus.connected || !configKey || configKey === displayApplied) return
    const t = setTimeout(() => { applyRef.current() }, LIVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [live, deviceStatus.connected, configKey, displayApplied])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const titles = useMemo(() => {
    const names = new Map<string, string>()
    config?.elements.forEach(el => {
      if (el.type === 'text') names.set(el.id, `“${resolve(el.text) || '…'}”`)
      else if (el.type === 'image') names.set(el.id, `Image · ${el.path.split(/[\\/]/).pop() || 'none'}`)
      else names.set(el.id, `${el.type === 'gauge' ? (el.sweep >= 360 ? 'Ring' : 'Gauge') : el.type === 'bar' ? 'Bar' : 'Graph'} · ${el.label || optionFor(metrics, el.metric).label}`)
    })
    return names
  }, [config, metrics, resolve])

  if (!config) return <div style={{ color: '#7f7f7f', fontSize: 13, padding: 24 }}>Loading editor…</div>

  const selected = config.elements.find(el => el.id === selectedId) ?? null
  const selectedIds = [...(selected ? [selected.id] : []), ...extraIds.filter(id => config.elements.some(el => el.id === id))]
  const dirty = JSON.stringify(config) !== displayApplied
  const connected = deviceStatus.connected

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 330px', gap: 16, height: '100%', minHeight: 0, position: 'relative' }}>
      {firstRun && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: '#0e0e0ef2', borderRadius: 12, overflow: 'auto', padding: 16 }}>
          <FirstRunPicker accent={accent} onPick={c => { applyLayout(c); setFirstRun(false) }} onSkip={() => setFirstRun(false)}/>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0 }}>
        <div ref={areaRef} style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center' }}>
          <SceneCanvas
            config={config} previewUrl={previewUrl} selectedIds={selectedIds} size={size} accent={accent} resolve={resolve}
            onSelect={select} onGestureStart={() => snapshot()} onPatch={mapElement} onPatchMany={mapMany}
            onTextEdit={(id, text) => editElement(id, { text })}
            onContextMenu={(id, x, y) => setMenu({ id, x, y })}
            onDropKind={(kind, x, y) => addKind(kind as AddKind, { x, y })}
          />
        </div>
        {selectedIds.length >= 2 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#7f7f7f' }}>{selectedIds.length} selected</span>
            {ALIGN_BUTTONS.map(({ mode, label }) => (
              <Pill key={mode} accent={accent} onClick={() => alignSelection(mode)} title={label}>{ALIGN_SHORT[mode]}</Pill>
            ))}
          </div>
        )}
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
          <Pill accent={accent} onClick={redo} title="Redo (Ctrl+Shift+Z)"><ArrowClockwise size={13}/>Redo</Pill>
          <Pill accent={accent} onClick={revert} title="Back to the last applied scene"><ArrowUUpLeft size={13}/>Revert</Pill>
          <Pill accent={accent} active={live} onClick={toggleLive} title="Save and apply automatically shortly after you stop editing">Apply as I edit</Pill>
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
              <div key={kind} draggable title="Click to add, or drag onto the screen"
                onDragStart={e => { e.dataTransfer.setData('text/plain', `kraken-add:${kind}`); e.dataTransfer.effectAllowed = 'copy' }}>
                <Pill accent={accent} onClick={() => addKind(kind)}><Icon size={13}/>{label}</Pill>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <SectionTitle>Layers (top first)</SectionTitle>
          {config.elements.length === 0 && <div style={{ fontSize: 11, color: '#7f7f7f' }}>Nothing on the screen yet. Add something above.</div>}
          {[...config.elements].reverse().map(el => {
            const Icon = iconFor(el)
            const active = selectedIds.includes(el.id)
            return (
              <div key={el.id} onClick={e => select(el.id, e.shiftKey)} style={{
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
          : <ScenePanel
              config={config} accent={accent} onChange={editScene} onLayout={applyLayout}
              onRestyle={(elements, background) => editScene(background ? { elements, background } : { elements })}
            />}
      </Card>

      {menu && (
        <div onPointerDown={e => e.stopPropagation()} style={{
          position: 'fixed', left: menu.x, top: menu.y, zIndex: 50, minWidth: 150, padding: 4, borderRadius: 8,
          background: '#141414', border: '1px solid #2a2a2a', boxShadow: '0 8px 24px #000a', display: 'flex', flexDirection: 'column',
        }}>
          {([
            ['Duplicate', () => duplicateElement(menu.id)],
            ['Bring forward', () => reorderElement(menu.id, 1)],
            ['Send backward', () => reorderElement(menu.id, -1)],
            ['Delete', () => removeElement(menu.id)],
          ] as [string, () => void][]).map(([label, run]) => (
            <button key={label} onClick={() => { setMenu(null); run() }} style={{
              textAlign: 'left', padding: '6px 10px', border: 'none', borderRadius: 5, background: 'transparent',
              color: label === 'Delete' ? '#ff4757' : '#d0d0d0', fontSize: 12, cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
