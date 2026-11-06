import { useState, useRef, useEffect } from 'react'
import { CaretDown } from '@phosphor-icons/react'

interface Props {
  value: string
  options: string[]
  onChange: (v: string) => void
  width?: number | string
  small?: boolean
  accent?: string
}

export function Dropdown({ value, options, onChange, width = 160, small }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative', width, flexShrink: 0 }}>
      <button className="adw-btn" onClick={() => setOpen(o => !o)} style={{
        width: '100%', minHeight: small ? 28 : 34, justifyContent: 'space-between',
        padding: '0 10px', fontWeight: 400, fontSize: small ? 12 : 14,
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        <CaretDown size={10} weight="bold" style={{ flexShrink: 0, color: 'var(--fg-dim)' }}/>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 400,
          background: 'var(--popover)', borderRadius: 12, padding: 6, boxShadow: 'var(--shadow-popover)',
          maxHeight: 280, overflowY: 'auto',
        }}>
          {options.map(opt => (
            <div key={opt} className="adw-row" onClick={() => { onChange(opt); setOpen(false) }} style={{
              padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: small ? 12 : 14,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              {opt}
              {opt === value && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
