/** Small form controls shared by the element inspector and the screen settings. */
import { ReactNode } from 'react'
import { Slider } from '../ui/Slider'
import { Dropdown } from '../ui/Dropdown'

const LABEL: React.CSSProperties = { fontSize: 12, color: '#a0a0a0', fontWeight: 500, width: 92, flexShrink: 0 }
const INPUT: React.CSSProperties = {
  background: '#0d0d0d', border: '1px solid #252525', borderRadius: 8, color: '#e0e0e0', fontSize: 12,
  padding: '4px 8px', minWidth: 0,
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 28 }}>
      <div style={LABEL}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

export function NumField({ label, value, min, max, sliderMax = max, step = 1, unit = '', accent, onChange }: {
  label: string; value: number; min: number; max: number; sliderMax?: number; step?: number; unit?: string; accent: string; onChange: (v: number) => void
}) {
  return (
    <Field label={label}>
      <div style={{ flex: 1, minWidth: 0 }}><Slider value={Math.min(sliderMax, Math.max(min, value))} min={min} max={sliderMax} onChange={onChange} color={accent}/></div>
      <input
        type="number" value={Math.round(value * 100) / 100} min={min} max={max} step={step}
        onChange={e => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) onChange(v) }}
        aria-label={label}
        style={{ ...INPUT, width: 58, fontFamily: 'JetBrains Mono, monospace' }}
      />
      {unit && <span style={{ fontSize: 11, color: '#7f7f7f', width: 14 }}>{unit}</span>}
    </Field>
  )
}

export function TextField({ label, value, placeholder, onChange, maxLength }: {
  label: string; value: string; placeholder?: string; maxLength?: number; onChange: (v: string) => void
}) {
  return (
    <Field label={label}>
      <input value={value} placeholder={placeholder} maxLength={maxLength} onChange={e => onChange(e.target.value)}
        aria-label={label} style={{ ...INPUT, flex: 1 }}/>
    </Field>
  )
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <label style={{ position: 'relative', width: 22, height: 22, flexShrink: 0, cursor: 'pointer' }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: value, boxShadow: '0 0 0 2px #0d0d0d, 0 0 0 3px #2a2a2a' }}/>
        <input type="color" value={value} onChange={e => onChange(e.target.value)} aria-label={label}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}/>
      </label>
      <span style={{ fontSize: 11, color: '#7f7f7f', fontFamily: 'JetBrains Mono, monospace' }}>{value}</span>
    </Field>
  )
}

export function CheckField({ label, checked, accent, onChange, children }: {
  label: string; checked: boolean; accent: string; onChange: (v: boolean) => void; children?: ReactNode
}) {
  return (
    <Field label={label}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} aria-label={label}
        style={{ width: 14, height: 14, accentColor: accent, cursor: 'pointer' }}/>
      {children}
    </Field>
  )
}

export function SelectField({ label, value, options, accent, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; accent: string; onChange: (v: string) => void
}) {
  const current = options.find(o => o.value === value)?.label ?? value
  return (
    <Field label={label}>
      <Dropdown value={current} options={options.map(o => o.label)} width="100%" small accent={accent}
        onChange={l => { const o = options.find(x => x.label === l); if (o) onChange(o.value) }}/>
    </Field>
  )
}

export function Pill({ active, accent, onClick, children, title }: {
  active?: boolean; accent: string; onClick: () => void; children: ReactNode; title?: string
}) {
  return (
    <button onClick={onClick} title={title} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
      cursor: 'pointer', border: `1px solid ${active ? `${accent}55` : '#252525'}`,
      background: active ? `${accent}18` : '#111', color: active ? accent : '#9a9a9a', transition: 'all 120ms',
    }}>{children}</button>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>{children}</div>
}
