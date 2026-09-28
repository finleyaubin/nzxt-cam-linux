import { useEffect, useRef, useState } from 'react'
import { Plus, X } from '@phosphor-icons/react'
import { Sensor, SensorSlot } from '../lib/api'
import { useApp } from '../context/AppContext'
import { MAX_SENSORS, defaultMaxForUnit, formatMetric } from '@shared/display'

const selectStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8, background: '#0d0d0d', color: '#c0c0c0',
  border: '1px solid #1e1e1e', fontSize: 12,
}

/** Catalog grouped by source ("System", "NVIDIA GPU 0", "coretemp", …) for <optgroup>s. */
function SensorOptions({ catalog }: { catalog: Sensor[] }) {
  const groups = new Map<string, Sensor[]>()
  for (const s of catalog) {
    const group = s.label.split(' · ')[0]
    groups.set(group, [...(groups.get(group) ?? []), s])
  }
  return (
    <>
      {[...groups].map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map(s => <option key={s.id} value={s.id}>{s.label.split(' · ').slice(1).join(' · ') || s.label} ({s.unit})</option>)}
        </optgroup>
      ))}
    </>
  )
}

function MaxField({ slot, unit, onChange }: { slot: SensorSlot; unit: string; onChange: (max: number | null) => void }) {
  const [draft, setDraft] = useState(slot.max?.toString() ?? '')
  useEffect(() => setDraft(slot.max?.toString() ?? ''), [slot.max])
  const commit = () => {
    const n = parseFloat(draft)
    onChange(Number.isFinite(n) && n > 0 ? n : null)
  }

  if (unit === '%') {
    return <span style={{ fontSize: 11, color: '#7f7f7f', width: 132, textAlign: 'right' }}>0-100%</span>
  }
  return (
    <label title="Reading shown as a full gauge or bar" style={{ display: 'flex', alignItems: 'center', gap: 6, width: 132 }}>
      <span style={{ fontSize: 11, color: '#7f7f7f', whiteSpace: 'nowrap' }}>100% at</span>
      <input
        type="number" min={0} value={draft} placeholder={String(defaultMaxForUnit(unit))}
        onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }}
        style={{ width: 64, padding: '7px 8px', borderRadius: 8, border: '1px solid #1e1e1e', background: '#0d0d0d', color: '#e0e0e0', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}
      />
      <span style={{ fontSize: 11, color: '#7f7f7f' }}>{unit}</span>
    </label>
  )
}

export function SensorList({ slots, catalog, accent, onChange }: {
  slots: SensorSlot[]; catalog: Sensor[]; accent: string; onChange: (slots: SensorSlot[]) => void
}) {
  const { state } = useApp()
  const [adding, setAdding] = useState(false)
  const addRef = useRef<HTMLSelectElement>(null)
  useEffect(() => { if (adding) addRef.current?.focus() }, [adding])

  const bound = slots.map((slot, i) => ({ slot, i, sensor: catalog.find(s => s.id === slot.source) })).filter(b => b.slot.source)
  const unbound = catalog.filter(s => !slots.some(slot => slot.source === s.id))
  const full = bound.length >= MAX_SENSORS

  const setSlot = (i: number, patch: Partial<SensorSlot>) =>
    onChange(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  // Removed slots stay as holes so sensorN in saved LCD layouts keeps pointing at the same sensor.
  const remove = (i: number) => setSlot(i, { source: null, max: null })

  const add = (source: string) => {
    setAdding(false)
    if (!source) return
    const hole = slots.findIndex(s => !s.source)
    onChange(hole === -1 ? [...slots, { source, max: null }] : slots.map((s, j) => (j === hole ? { source, max: null } : s)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {bound.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: '#7f7f7f', padding: '10px 12px', border: '1px dashed #2a2a2a', borderRadius: 8 }}>
          No extra sensors yet. Add GPU load, fan speed, RAM use or any other reading to show it on the LCD.
        </div>
      )}

      {bound.map(({ slot, i, sensor }) => {
        const live = state.temperatures.sensors?.[i]
        return (
          <div key={i} className="fade-up" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 6px 10px', borderRadius: 8, background: '#0f0f0f', border: '1px solid #1a1a1a' }}>
            <select value={slot.source ?? ''} onChange={e => setSlot(i, { source: e.target.value, max: null })} aria-label="Sensor" style={selectStyle}>
              {!sensor && <option value={slot.source ?? ''}>Unavailable sensor</option>}
              {sensor && <option value={sensor.id}>{sensor.label} ({sensor.unit})</option>}
              <SensorOptions catalog={unbound}/>
            </select>
            <span style={{ fontSize: 11, color: '#9a9a9a', fontFamily: 'JetBrains Mono, monospace', width: 64, textAlign: 'right' }}>
              {sensor && live !== undefined ? `${formatMetric(live, 0)}${sensor.unit === '°' || sensor.unit === '%' ? sensor.unit : ` ${sensor.unit}`}` : ''}
            </span>
            <MaxField slot={slot} unit={sensor?.unit ?? ''} onChange={max => setSlot(i, { max })}/>
            <button onClick={() => remove(i)} aria-label={`Remove ${sensor?.label ?? 'sensor'}`} style={{
              display: 'flex', padding: 7, borderRadius: 8, border: 'none', background: 'transparent', color: '#7f7f7f', cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4757' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#7f7f7f' }}
            ><X size={14}/></button>
          </div>
        )
      })}

      {adding ? (
        <div className="fade-up" style={{ display: 'flex', gap: 6 }}>
          <select ref={addRef} defaultValue="" onChange={e => add(e.target.value)} onBlur={() => setAdding(false)}
            onKeyDown={e => { if (e.key === 'Escape') setAdding(false) }} aria-label="Choose a sensor to add" style={{ ...selectStyle, borderColor: `${accent}55` }}>
            <option value="" disabled>Choose a sensor…</option>
            <SensorOptions catalog={unbound}/>
          </select>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} disabled={full} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', borderRadius: 8,
          border: `1px dashed ${full ? '#1e1e1e' : '#2e2e2e'}`, background: 'transparent',
          color: full ? '#555' : '#9a9a9a', fontSize: 12, fontWeight: 600, cursor: full ? 'not-allowed' : 'pointer',
          transition: 'all 130ms',
        }}
        onMouseEnter={e => { if (!full) { e.currentTarget.style.borderColor = `${accent}88`; e.currentTarget.style.color = accent } }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = full ? '#1e1e1e' : '#2e2e2e'; e.currentTarget.style.color = full ? '#555' : '#9a9a9a' }}
        >
          <Plus size={13}/>
          {full ? `Up to ${MAX_SENSORS} sensors` : 'Add sensor'}
        </button>
      )}
    </div>
  )
}
