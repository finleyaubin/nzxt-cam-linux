import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, Plus } from '@phosphor-icons/react'
import { MetricId } from '@shared/display'
import { Sensor } from '../../lib/api'
import { bindSensor, useSensorCatalog } from '../../hooks/useSensorSlots'
import { Field, Pill } from './fields'
import { MetricOption } from './metrics'

const SOURCES = ['System', 'NVIDIA GPU', 'Hardware', 'Home Assistant']
const MAX_ROWS = 100

const sourceOf = (id: string) =>
  id.startsWith('ha:') ? 'Home Assistant' : id.startsWith('sys:') ? 'System' : id.startsWith('nvidia-smi:') ? 'NVIDIA GPU' : 'Hardware'

const shortLabel = (label: string) => label.replace(/^(Home Assistant|System) · /, '')

function highlight(text: string, tokens: string[]): ReactNode {
  if (!tokens.length) return text
  const re = new RegExp(`(${tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return text.split(re).map((part, i) => i % 2 ? <mark key={i} style={{ background: 'none', color: '#fff', fontWeight: 700 }}>{part}</mark> : part)
}

type Choice = { kind: 'builtin'; builtin: MetricOption } | { kind: 'sensor'; sensor: Sensor }

interface MenuProps {
  catalog: Sensor[]
  builtins: MetricOption[]
  accent: string
  activeId?: string
  onBuiltin: (b: MetricOption) => void
  onSensor: (s: Sensor) => void
  onClose: () => void
}

/** Search box, source/unit filters and a keyboard-navigable list of every sensor. */
function SensorMenu({ catalog, builtins, accent, activeId, onBuiltin, onSensor, onClose }: MenuProps) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [unit, setUnit] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const hotRef = useRef<HTMLDivElement>(null)
  useEffect(() => setCursor(0), [query, source, unit])
  useEffect(() => hotRef.current?.scrollIntoView({ block: 'nearest' }), [cursor])

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (text: string) => tokens.every(t => text.toLowerCase().includes(t))

  const sourceCounts = useMemo(
    () => SOURCES.map(name => [name, catalog.filter(s => sourceOf(s.id) === name).length] as const).filter(([, n]) => n > 0),
    [catalog],
  )
  const inSource = useMemo(() => (source ? catalog.filter(s => sourceOf(s.id) === source) : catalog), [catalog, source])
  const unitCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of inSource) if (s.unit) counts.set(s.unit, (counts.get(s.unit) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [inSource])

  const found = inSource.filter(s => (!unit || s.unit === unit) && matches(`${s.label} ${s.id}`))
  const shown = found.slice(0, MAX_ROWS)
  const groups = SOURCES.map(name => [name, shown.filter(s => sourceOf(s.id) === name)] as const).filter(([, list]) => list.length)
  const shownBuiltins = source || unit ? [] : builtins.filter(b => matches(b.label))
  const choices: Choice[] = [
    ...shownBuiltins.map(builtin => ({ kind: 'builtin' as const, builtin })),
    ...groups.flatMap(([, list]) => list.map(sensor => ({ kind: 'sensor' as const, sensor }))),
  ]

  const pick = (c: Choice | undefined) => { if (c) c.kind === 'builtin' ? onBuiltin(c.builtin) : onSensor(c.sensor) }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, choices.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(choices[cursor]) }
    else if (e.key === 'Escape') onClose()
  }

  let index = 0
  const row = (key: string, label: ReactNode, rowUnit: string, title: string, selected: boolean, onClick: () => void) => {
    const i = index++
    const hot = i === cursor
    return (
      <div key={key} ref={hot ? hotRef : undefined} title={title} onClick={onClick} onMouseMove={() => setCursor(i)} style={{
        display: 'flex', gap: 8, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
        color: selected ? accent : '#b8b8b8', background: hot ? 'rgba(255,255,255,0.07)' : selected ? `${accent}1a` : 'transparent',
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {rowUnit && <span style={{ color: '#6f6f6f', fontSize: 10, alignSelf: 'center' }}>{rowUnit}</span>}
      </div>
    )
  }
  const head = (t: string, n?: number) => (
    <div style={{ padding: '6px 10px 2px', fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>
      {t}{n !== undefined && ` · ${n}`}
    </div>
  )
  const chips = (children: ReactNode) => <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 2px 6px' }}>{children}</div>

  return (
    <div onKeyDown={onKeyDown}>
      <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sensors…" aria-label="Search sensors"
        style={{ width: '100%', boxSizing: 'border-box', background: '#0d0d0d', border: '1px solid #252525', borderRadius: 8, color: '#e0e0e0', fontSize: 12, padding: '4px 8px', marginBottom: 6 }}/>
      {sourceCounts.length > 1 && chips(
        <>
          <Pill active={!source} accent={accent} onClick={() => { setSource(null); setUnit(null) }}>All {catalog.length}</Pill>
          {sourceCounts.map(([name, n]) => (
            <Pill key={name} active={source === name} accent={accent} onClick={() => { setSource(source === name ? null : name); setUnit(null) }}>{name} {n}</Pill>
          ))}
        </>,
      )}
      {unitCounts.length > 1 && chips(
        unitCounts.map(([u, n]) => (
          <Pill key={u} active={unit === u} accent={accent} onClick={() => setUnit(unit === u ? null : u)}>{u} {n}</Pill>
        )),
      )}
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {shownBuiltins.length > 0 && head('Built-in')}
        {shownBuiltins.map(b => row(b.id, highlight(b.label, tokens), b.unit, b.label, b.id === activeId, () => onBuiltin(b)))}
        {groups.map(([name, list]) => (
          <div key={name}>
            {head(name, list.length)}
            {list.map(s => row(s.id, highlight(shortLabel(s.label), tokens), s.unit, s.id, s.id === activeId, () => onSensor(s)))}
          </div>
        ))}
        {choices.length === 0 && <div style={{ padding: 10, fontSize: 11, color: '#7f7f7f' }}>No matches</div>}
        {found.length > MAX_ROWS && <div style={{ padding: '8px 10px', fontSize: 11, color: '#7f7f7f' }}>Showing {MAX_ROWS} of {found.length}. Type or filter to narrow.</div>}
      </div>
    </div>
  )
}

function Popover({ trigger, children }: { trigger: (toggle: () => void, open: boolean) => ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {trigger(() => setOpen(o => !o), open)}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#1c1c1c', border: '1px solid #2c2c2c',
          borderRadius: 8, padding: 4, zIndex: 400, boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
        }}>{children(() => setOpen(false))}</div>
      )}
    </div>
  )
}

const errorLine = (error: string) => error && <div style={{ fontSize: 11, color: '#ff4757', paddingLeft: 102, lineHeight: 1.5 }}>{error}</div>

interface Props {
  value: MetricId
  /** Label of the current value. */
  currentLabel: string
  /** Built-in readings (cpu/gpu/liquid/pump). */
  builtins: MetricOption[]
  accent: string
  onPick: (m: { id: MetricId; label: string; max: number }) => void
}

/** Searchable, filterable list of every sensor; picking an unbound one binds it to a free slot automatically. */
export function SensorPicker({ value, currentLabel, builtins, accent, onPick }: Props) {
  const catalog = useSensorCatalog()
  const [error, setError] = useState('')

  return (
    <>
      <Field label="Shows">
        <Popover trigger={(toggle, open) => (
          <div onClick={toggle} style={{
            background: '#1c1c1c', border: `1px solid ${open ? accent : '#2c2c2c'}`, borderRadius: 8, height: 28, padding: '0 28px 0 10px',
            cursor: 'pointer', fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center', position: 'relative', userSelect: 'none',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentLabel}</span>
            <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#9a9a9a', display: 'flex' }}><CaretDown size={10}/></span>
          </div>
        )}>
          {close => (
            <SensorMenu catalog={catalog} builtins={builtins} accent={accent} activeId={value} onClose={close}
              onBuiltin={b => { setError(''); close(); onPick({ id: b.id, label: b.label, max: b.max }) }}
              onSensor={async s => {
                const res = await bindSensor(s)
                if (!res.ok) { setError(res.error); return }
                setError(''); close()
                onPick({ id: res.metric, label: s.label.replace(/\s*\(.*\)$/, ''), max: res.max })
              }}/>
          )}
        </Popover>
      </Field>
      {errorLine(error)}
    </>
  )
}

/** "+ Sensor" button for text elements: pick any sensor, bind it, and hand back its `{sensorN}` token. */
export function InsertSensor({ accent, onInsert }: { accent: string; onInsert: (token: string) => void }) {
  const catalog = useSensorCatalog()
  const [error, setError] = useState('')

  return (
    <div style={{ paddingLeft: 102 }}>
      <Popover trigger={(toggle, open) => (
        <div><Pill active={open} accent={accent} onClick={toggle} title="Insert any sensor into the text"><Plus size={10}/> Sensor</Pill></div>
      )}>
        {close => (
          <SensorMenu catalog={catalog} builtins={[]} accent={accent} onClose={close} onBuiltin={() => {}}
            onSensor={async s => {
              const res = await bindSensor(s)
              if (!res.ok) { setError(res.error); return }
              setError(''); close()
              onInsert(`{${res.metric}}`)
            }}/>
        )}
      </Popover>
      {error && <div style={{ fontSize: 11, color: '#ff4757', lineHeight: 1.5, marginTop: 4 }}>{error}</div>}
    </div>
  )
}
