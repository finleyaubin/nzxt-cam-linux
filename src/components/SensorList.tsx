import { useEffect, useState } from 'react'
import { CaretDown, Plus, X } from '@phosphor-icons/react'
import { Sensor, SensorSlot } from '../lib/api'
import { useApp } from '../context/AppContext'
import { useLanguage } from '../i18n/LangContext'
import { MAX_SENSORS, defaultMaxForUnit, formatMetric } from '@shared/display'
import { SensorDialog } from './display/SensorPicker'

/** Select-looking button; the choice itself is made in the sensor popup. */
export function PickerButton({ label, accent, onClick }: { label: string; accent?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px',
      borderRadius: 8, background: 'var(--window)', color: 'var(--fg)', border: `1px solid ${accent ? `${accent}55` : 'var(--border)'}`,
      fontSize: 13, cursor: 'pointer', textAlign: 'left',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <CaretDown size={10} color="var(--fg-dim)" style={{ flexShrink: 0 }}/>
    </button>
  )
}

function MaxField({ slot, unit, onChange }: { slot: SensorSlot; unit: string; onChange: (max: number | null) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(slot.max?.toString() ?? '')
  useEffect(() => setDraft(slot.max?.toString() ?? ''), [slot.max])
  const commit = () => {
    const n = parseFloat(draft)
    onChange(Number.isFinite(n) && n > 0 ? n : null)
  }

  if (unit === '%') {
    return <span style={{ fontSize: 12, color: 'var(--fg-dim)', width: 132, textAlign: 'right' }}>0-100%</span>
  }
  return (
    <label title={t('sensors.max_hint')} style={{ display: 'flex', alignItems: 'center', gap: 6, width: 132 }}>
      <span style={{ fontSize: 12, color: 'var(--fg-dim)', whiteSpace: 'nowrap' }}>{t('sensors.max_at')}</span>
      <input
        type="number" min={0} value={draft} placeholder={String(defaultMaxForUnit(unit))}
        onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }}
        style={{ width: 64, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--window)', color: 'var(--fg)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
      />
      <span style={{ fontSize: 12, color: 'var(--fg-dim)' }}>{unit}</span>
    </label>
  )
}

export function SensorList({ slots, catalog, accent, onChange }: {
  slots: SensorSlot[]; catalog: Sensor[]; accent: string; onChange: (slots: SensorSlot[]) => void
}) {
  const { state } = useApp()
  const { t } = useLanguage()
  const [picking, setPicking] = useState<number | 'new' | null>(null)

  const bound = slots.map((slot, i) => ({ slot, i, sensor: catalog.find(s => s.id === slot.source) })).filter(b => b.slot.source)
  const full = bound.length >= MAX_SENSORS

  const setSlot = (i: number, patch: Partial<SensorSlot>) =>
    onChange(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  // Removed slots stay as holes so sensorN in saved LCD layouts keeps pointing at the same sensor.
  const remove = (i: number) => setSlot(i, { source: null, max: null })

  const add = (source: string) => {
    const hole = slots.findIndex(s => !s.source)
    onChange(hole === -1 ? [...slots, { source, max: null }] : slots.map((s, j) => (j === hole ? { source, max: null } : s)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {bound.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--fg-dim)', padding: '10px 12px', border: '1px dashed var(--border)', borderRadius: 8 }}>
          {t('sensors.none_yet')}
        </div>
      )}

      {bound.map(({ slot, i, sensor }) => {
        const live = state.temperatures.sensors?.[i]
        return (
          <div key={i} className="fade-up" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 6px 10px', borderRadius: 8, background: 'var(--window)', border: '1px solid var(--card)' }}>
            <PickerButton label={sensor ? `${sensor.label} (${sensor.unit})` : 'Unavailable sensor'} onClick={() => setPicking(i)}/>
            <span style={{ fontSize: 12, color: 'var(--fg-dim)', fontVariantNumeric: 'tabular-nums', width: 64, textAlign: 'right' }}>
              {sensor && live !== undefined ? `${formatMetric(live, 0)}${sensor.unit === '°' || sensor.unit === '%' ? sensor.unit : ` ${sensor.unit}`}` : ''}
            </span>
            <MaxField slot={slot} unit={sensor?.unit ?? ''} onChange={max => setSlot(i, { max })}/>
            <button onClick={() => remove(i)} aria-label={t('sensors.remove', { name: sensor?.label ?? t('sensors.fallback_name') })} style={{
              display: 'flex', padding: 7, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--fg-dim)', cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#f66151' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-dim)' }}
            ><X size={14}/></button>
          </div>
        )
      })}

      <button onClick={() => setPicking('new')} disabled={full} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', borderRadius: 8,
        border: `1px dashed ${full ? 'var(--border)' : '#2e2e2e'}`, background: 'transparent',
        color: full ? 'var(--fg-dim)' : 'var(--fg-dim)', fontSize: 13, fontWeight: 600, cursor: full ? 'not-allowed' : 'pointer',
        transition: 'all 130ms',
      }}
      onMouseEnter={e => { if (!full) { e.currentTarget.style.borderColor = `${accent}88`; e.currentTarget.style.color = accent } }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = full ? 'var(--border)' : '#2e2e2e'; e.currentTarget.style.color = full ? 'var(--fg-dim)' : 'var(--fg-dim)' }}
      >
        <Plus size={13}/>
        {full ? t('sensors.limit', { max: MAX_SENSORS }) : t('sensors.add')}
      </button>

      {picking !== null && (
        <SensorDialog title={t('sensors.choose')} builtins={[]} accent={accent} onClose={() => setPicking(null)}
          only={s => !slots.some(slot => slot.source === s.id)} onBuiltin={() => {}}
          onSensor={async s => { if (picking === 'new') add(s.id); else setSlot(picking, { source: s.id, max: null }) }}/>
      )}
    </div>
  )
}
