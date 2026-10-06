import { useEffect, useRef, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { MetricId } from '@shared/display'
import { Sensor } from '../../lib/api'
import { bindSensor, useSensorCatalog } from '../../hooks/useSensorSlots'
import { Field } from './fields'
import { MetricOption } from './metrics'

interface Props {
  value: MetricId
  /** Label of the current value. */
  currentLabel: string
  /** Built-in readings (cpu/gpu/liquid/pump). */
  builtins: MetricOption[]
  accent: string
  onPick: (m: { id: MetricId; label: string; max: number }) => void
}

/** Searchable list of every sensor; picking an unbound one binds it to a free slot automatically. */
export function SensorPicker({ value, currentLabel, builtins, accent, onPick }: Props) {
  const catalog = useSensorCatalog()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const q = query.trim().toLowerCase()
  const match = (s: string) => !q || s.toLowerCase().includes(q)
  const groups = new Map<string, Sensor[]>()
  for (const s of catalog.filter(s => match(s.label) || match(s.id))) {
    const g = s.unit === '°' ? 'Temperature' : s.unit === '%' ? 'Load / percent' : s.unit ? `Other (${s.unit})` : 'Other'
    groups.set(g, [...(groups.get(g) ?? []), s])
  }
  const shownBuiltins = builtins.filter(b => match(b.label))

  const pickBuiltin = (b: MetricOption) => { setError(''); setOpen(false); onPick({ id: b.id, label: b.label, max: b.max }) }
  const pickSensor = async (s: Sensor) => {
    const res = await bindSensor(s)
    if (!res.ok) { setError(res.error); return }
    setError(''); setOpen(false)
    onPick({ id: res.metric, label: s.label.replace(/\s*\(.*\)$/, ''), max: res.max })
  }

  const head = (t: string) => <div style={{ padding: '6px 10px 2px', fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>{t}</div>
  const row = (key: string, label: string, onClick: () => void, active = false) => (
    <div key={key} onClick={onClick} style={{
      padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: active ? accent : '#b8b8b8',
      background: active ? `${accent}1a` : 'transparent',
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>{label}</div>
  )

  return (
    <>
      <Field label="Shows">
        <div ref={ref} style={{ position: 'relative', width: '100%' }}>
          <div onClick={() => setOpen(o => !o)} style={{
            background: '#1c1c1c', border: `1px solid ${open ? accent : '#2c2c2c'}`, borderRadius: 8, height: 28, padding: '0 28px 0 10px',
            cursor: 'pointer', fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center', position: 'relative', userSelect: 'none',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentLabel}</span>
            <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#9a9a9a', display: 'flex' }}><CaretDown size={10}/></span>
          </div>
          {open && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#1c1c1c', border: '1px solid #2c2c2c',
              borderRadius: 8, padding: 4, zIndex: 400, boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
            }}>
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sensors…" aria-label="Search sensors"
                style={{ width: '100%', boxSizing: 'border-box', background: '#0d0d0d', border: '1px solid #252525', borderRadius: 8, color: '#e0e0e0', fontSize: 12, padding: '4px 8px', marginBottom: 4 }}/>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {shownBuiltins.length > 0 && head('Built-in')}
                {shownBuiltins.map(b => row(b.id, b.label, () => pickBuiltin(b), b.id === value))}
                {[...groups].map(([g, list]) => (
                  <div key={g}>{head(g)}{list.map(s => row(s.id, s.label, () => pickSensor(s)))}</div>
                ))}
                {shownBuiltins.length === 0 && groups.size === 0 && <div style={{ padding: 10, fontSize: 11, color: '#7f7f7f' }}>No matches</div>}
              </div>
            </div>
          )}
        </div>
      </Field>
      {error && <div style={{ fontSize: 11, color: '#ff4757', paddingLeft: 102, lineHeight: 1.5 }}>{error}</div>}
    </>
  )
}
