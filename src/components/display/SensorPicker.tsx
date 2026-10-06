import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'
import { MAX_SENSORS, MetricId } from '@shared/display'
import { Sensor } from '../../lib/api'
import { bindSensor, useBoundSources, useSensorCatalog } from '../../hooks/useSensorSlots'
import { Field, Pill } from './fields'
import { MetricOption } from './metrics'

const BUILTIN = 'Built-in'
const IN_USE = 'In use'
const SOURCES = [BUILTIN, 'System', 'NVIDIA GPU', 'Hardware', 'Home Assistant']
const MAX_ROWS = 150

const sourceOf = (id: string) =>
  id.startsWith('ha:') ? 'Home Assistant' : id.startsWith('sys:') ? 'System' : id.startsWith('nvidia-smi:') ? 'NVIDIA GPU' : 'Hardware'

const shortLabel = (label: string) => label.replace(/^(Home Assistant|System) · /, '')

function highlight(text: string, tokens: string[]): ReactNode {
  if (!tokens.length) return text
  const re = new RegExp(`(${tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return text.split(re).map((part, i) => i % 2 ? <mark key={i} style={{ background: 'none', color: '#fff', fontWeight: 700 }}>{part}</mark> : part)
}

interface Row {
  key: string
  label: string
  /** Secondary line, e.g. the Home Assistant entity id. */
  sub: string
  unit: string
  source: string
  bound: boolean
  active: boolean
  builtin?: MetricOption
  sensor?: Sensor
}

interface DialogProps {
  title: string
  builtins: MetricOption[]
  /** Metric currently shown, so its row is marked. */
  activeId?: MetricId
  accent: string
  onBuiltin: (b: MetricOption) => void
  /** Resolve with an error message to keep the dialog open and show it. */
  onSensor: (s: Sensor) => Promise<string | void>
  onClose: () => void
}

/** Popup with search, source/unit filters and a keyboard-navigable list of every sensor. */
function SensorDialog({ title, builtins, activeId, accent, onBuiltin, onSensor, onClose }: DialogProps) {
  const catalog = useSensorCatalog()
  const boundSources = useBoundSources()
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [unit, setUnit] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [error, setError] = useState('')
  const hotRef = useRef<HTMLDivElement>(null)
  useEffect(() => setCursor(0), [query, source, unit])
  useEffect(() => hotRef.current?.scrollIntoView({ block: 'nearest' }), [cursor])

  const activeSource = activeId?.startsWith('sensor') ? boundSources[Number(activeId.slice(6)) - 1] : null
  const rows = useMemo<Row[]>(() => [
    ...builtins.map(b => ({ key: b.id, label: b.label, sub: '', unit: b.unit, source: BUILTIN, bound: false, active: b.id === activeId, builtin: b })),
    ...catalog.map(s => ({
      key: s.id, label: shortLabel(s.label), sub: s.id.startsWith('ha:') ? s.id.slice(3) : '', unit: s.unit, source: sourceOf(s.id),
      bound: boundSources.includes(s.id), active: s.id === activeSource, sensor: s,
    })),
  ], [builtins, catalog, boundSources, activeId, activeSource])

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (text: string) => tokens.every(t => text.toLowerCase().includes(t))

  const sourceCounts = SOURCES.map(name => [name, rows.filter(r => r.source === name).length] as const).filter(([, n]) => n > 0)
  const inUseCount = rows.filter(r => r.bound).length
  const inSource = rows.filter(r => !source || (source === IN_USE ? r.bound : r.source === source))
  const unitCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of inSource) if (r.unit) counts.set(r.unit, (counts.get(r.unit) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])
  }, [inSource])

  const found = inSource.filter(r => (!unit || r.unit === unit) && matches(`${r.label} ${r.sub}`))
  const pinned = !query && !source && !unit
  const inUse = pinned ? found.filter(r => r.bound) : []
  const shown = (pinned ? found.filter(r => !r.bound) : found).slice(0, MAX_ROWS)
  const groups: (readonly [string, Row[]])[] = [
    ...(inUse.length ? [[IN_USE, inUse] as const] : []),
    ...SOURCES.map(name => [name, shown.filter(r => r.source === name)] as const).filter(([, list]) => list.length),
  ]
  const flat = groups.flatMap(([, list]) => list)

  const pick = async (row: Row | undefined) => {
    if (!row) return
    if (row.builtin) { onBuiltin(row.builtin); onClose(); return }
    const failure = await onSensor(row.sensor!)
    if (failure) setError(failure)
    else onClose()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(flat[cursor]) }
    else if (e.key === 'Escape') onClose()
    e.stopPropagation()
  }

  const filterItem = (key: string, label: string, count: number, active: boolean, onClick: () => void) => (
    <div key={key} onClick={onClick} style={{
      display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
      color: active ? accent : '#b8b8b8', background: active ? `${accent}1a` : 'transparent',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: '#6f6f6f' }}>{count}</span>
    </div>
  )
  const filterHead = (t: string) => <div style={{ padding: '10px 10px 4px', fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>{t}</div>

  let index = 0
  const renderRow = (r: Row, showBadge: boolean) => {
    const i = index++
    const hot = i === cursor
    return (
      <div key={r.key} ref={hot ? hotRef : undefined} title={r.sensor?.id ?? r.label} onClick={() => pick(r)} onMouseMove={() => setCursor(i)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
        background: hot ? 'rgba(255,255,255,0.07)' : r.active ? `${accent}1a` : 'transparent',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: r.active ? accent : '#d0d0d0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{highlight(r.label, tokens)}</div>
          {r.sub && <div style={{ fontSize: 10, color: '#6f6f6f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{highlight(r.sub, tokens)}</div>}
        </div>
        {showBadge && r.bound && <span style={{ fontSize: 10, color: accent }}>in use</span>}
        {r.unit && <span style={{ fontSize: 11, color: '#7f7f7f', minWidth: 28, textAlign: 'right' }}>{r.unit}</span>}
      </div>
    )
  }

  return createPortal(
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} onKeyDown={onKeyDown} style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
    }}>
      <div role="dialog" aria-modal="true" aria-label={title} style={{
        width: 'min(780px, 100%)', height: 'min(580px, 100%)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12, boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid #222' }}>
          <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#0d0d0d', border: '1px solid #252525', borderRadius: 8, padding: '0 10px' }}>
            <MagnifyingGlass size={13} color="#7f7f7f"/>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or entity id…" aria-label="Search sensors"
              style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: '#e0e0e0', fontSize: 12, padding: '7px 0' }}/>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ display: 'flex', padding: 6, borderRadius: 8, border: '1px solid #252525', background: '#111', color: '#9a9a9a', cursor: 'pointer' }}><X size={13}/></button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ width: 190, flexShrink: 0, overflowY: 'auto', padding: '2px 8px 10px', borderRight: '1px solid #222' }}>
            {filterHead('Source')}
            {filterItem('all', 'All', rows.length, !source, () => { setSource(null); setUnit(null) })}
            {inUseCount > 0 && filterItem(IN_USE, 'In use on the LCD', inUseCount, source === IN_USE, () => { setSource(source === IN_USE ? null : IN_USE); setUnit(null) })}
            {sourceCounts.map(([name, n]) => filterItem(name, name, n, source === name, () => { setSource(source === name ? null : name); setUnit(null) }))}
            {unitCounts.length > 1 && filterHead('Unit')}
            {unitCounts.length > 1 && filterItem('any-unit', 'Any unit', inSource.length, !unit, () => setUnit(null))}
            {unitCounts.length > 1 && unitCounts.map(([u, n]) => filterItem(u, u, n, unit === u, () => setUnit(unit === u ? null : u)))}
          </div>

          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '4px 8px 10px' }}>
            {groups.map(([name, list]) => (
              <div key={name}>
                <div style={{ padding: '10px 10px 4px', fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>{name} · {list.length}</div>
                {list.map(r => renderRow(r, name !== IN_USE))}
              </div>
            ))}
            {flat.length === 0 && <div style={{ padding: 16, fontSize: 12, color: '#7f7f7f' }}>{catalog.length === 0 ? 'Loading sensors…' : 'No sensors match.'}</div>}
            {found.length > MAX_ROWS && <div style={{ padding: '10px', fontSize: 11, color: '#7f7f7f' }}>Showing {MAX_ROWS} of {found.length}. Type or filter to narrow.</div>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, padding: '8px 14px', borderTop: '1px solid #222', fontSize: 11, color: error ? '#ff4757' : '#7f7f7f' }}>
          <span style={{ flex: 1 }}>{error || '↑↓ to move · Enter to choose · Esc to close'}</span>
          <span>{boundSources.filter(Boolean).length} of {MAX_SENSORS} sensor slots in use</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

interface Props {
  value: MetricId
  /** Label of the current value. */
  currentLabel: string
  /** Built-in readings (cpu/gpu/liquid/pump). */
  builtins: MetricOption[]
  accent: string
  onPick: (m: { id: MetricId; label: string; max: number }) => void
}

/** Select-style button that opens the sensor popup; picking an unbound sensor binds it to a free slot automatically. */
export function SensorPicker({ value, currentLabel, builtins, accent, onPick }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Field label="Shows">
        <div onClick={() => setOpen(true)} style={{
          flex: 1, background: '#1c1c1c', border: `1px solid ${open ? accent : '#2c2c2c'}`, borderRadius: 8, height: 28, padding: '0 28px 0 10px',
          cursor: 'pointer', fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center', position: 'relative', userSelect: 'none', minWidth: 0,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentLabel}</span>
          <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#9a9a9a', display: 'flex' }}><CaretDown size={10}/></span>
        </div>
      </Field>
      {open && (
        <SensorDialog title="Choose what this shows" builtins={builtins} activeId={value} accent={accent} onClose={() => setOpen(false)}
          onBuiltin={b => onPick({ id: b.id, label: b.label, max: b.max })}
          onSensor={async s => {
            const res = await bindSensor(s)
            if (!res.ok) return res.error
            onPick({ id: res.metric, label: s.label.replace(/\s*\(.*\)$/, ''), max: res.max })
          }}/>
      )}
    </>
  )
}

/** "+ Sensor" button for text elements: pick any reading in the popup and hand back its `{variable}` token. */
export function InsertSensor({ builtins, accent, onInsert }: { builtins: MetricOption[]; accent: string; onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ paddingLeft: 102 }}>
      <Pill active={open} accent={accent} onClick={() => setOpen(true)} title="Insert any sensor into the text"><Plus size={10}/> Sensor</Pill>
      {open && (
        <SensorDialog title="Insert a sensor" builtins={builtins} accent={accent} onClose={() => setOpen(false)}
          onBuiltin={b => onInsert(`{${b.id}}`)}
          onSensor={async s => {
            const res = await bindSensor(s)
            if (!res.ok) return res.error
            onInsert(`{${res.metric}}`)
          }}/>
      )}
    </div>
  )
}
