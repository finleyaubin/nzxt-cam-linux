import { useEffect, useRef, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { api } from '../../lib/api'
import { Field } from './fields'

const MAX_ROWS = 200

let families: Promise<string[]> | null = null
const installedFonts = () => (families ??= api.listFonts().catch(() => []))

const quoted = (name: string) => `"${name.replace(/"/g, '')}", sans-serif`

interface Props {
  /** Chosen family, or null for the default. */
  value: string | null | undefined
  /** What null means here, e.g. "Default" or "Scene font". */
  defaultLabel: string
  accent: string
  onChange: (font: string | null) => void
}

/** Searchable list of installed fonts, each shown in its own typeface. */
export function FontPicker({ value, defaultLabel, accent, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [installed, setInstalled] = useState<string[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { installedFonts().then(setInstalled) }, [])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const q = query.trim().toLowerCase()
  const matches = (installed ?? []).filter(f => !q || f.toLowerCase().includes(q))
  const missing = !!value && installed !== null && !installed.includes(value)

  const pick = (font: string | null) => { setOpen(false); setQuery(''); onChange(font) }
  const row = (key: string, label: string, font: string | null, style?: React.CSSProperties) => {
    const active = font === (value ?? null)
    return (
      <div key={key} onClick={() => pick(font)} style={{
        padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 14, color: active ? accent : '#d0d0d0',
        background: active ? `${accent}1a` : 'transparent', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...style,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>{label}</div>
    )
  }

  return (
    <Field label="Font">
      <div ref={ref} style={{ position: 'relative', width: '100%' }}>
        <div onClick={() => setOpen(o => !o)} style={{
          background: '#1c1c1c', border: `1px solid ${open ? accent : '#2c2c2c'}`, borderRadius: 8, height: 28, padding: '0 28px 0 10px',
          cursor: 'pointer', fontSize: 13, color: '#ddd', display: 'flex', alignItems: 'center', position: 'relative', userSelect: 'none',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: value ? quoted(value) : undefined }}>
            {value ?? defaultLabel}
          </span>
          {missing && <span style={{ marginLeft: 6, fontSize: 10, color: '#ffb347', flexShrink: 0 }}>not installed</span>}
          <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#9a9a9a', display: 'flex' }}><CaretDown size={10}/></span>
        </div>
        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#1c1c1c', border: '1px solid #2c2c2c',
            borderRadius: 8, padding: 4, zIndex: 400, boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
          }}>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search fonts…" aria-label="Search fonts"
              style={{ width: '100%', boxSizing: 'border-box', background: '#0d0d0d', border: '1px solid #252525', borderRadius: 8, color: '#e0e0e0', fontSize: 12, padding: '4px 8px', marginBottom: 4 }}/>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {!q && row('default', defaultLabel, null, { fontSize: 12, fontStyle: 'italic' })}
              {matches.slice(0, MAX_ROWS).map(f => row(f, f, f, { fontFamily: quoted(f) }))}
              {installed === null && <div style={{ padding: 10, fontSize: 11, color: '#7f7f7f' }}>Looking for fonts…</div>}
              {installed !== null && matches.length === 0 && <div style={{ padding: 10, fontSize: 11, color: '#7f7f7f' }}>No matches</div>}
              {matches.length > MAX_ROWS && <div style={{ padding: 10, fontSize: 11, color: '#7f7f7f' }}>Showing {MAX_ROWS} of {matches.length}. Keep typing to narrow it down.</div>}
            </div>
          </div>
        )}
      </div>
    </Field>
  )
}
