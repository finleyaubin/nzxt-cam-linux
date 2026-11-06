import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown } from '@phosphor-icons/react'

interface Props {
  value: string
  options: string[]
  onChange: (v: string) => void
  width?: number | string
  small?: boolean
  accent?: string
}

const POPUP_MAX_HEIGHT = 280
const POPUP_MARGIN = 12
const MIN_ROOM_BELOW = 160

interface Placement { left: number; width: number; top?: number; bottom?: number; maxHeight: number }

function placeBelowOrAbove(trigger: DOMRect): Placement {
  const below = window.innerHeight - trigger.bottom - POPUP_MARGIN
  const above = trigger.top - POPUP_MARGIN
  const flip = below < MIN_ROOM_BELOW && above > below
  return flip
    ? { left: trigger.left, width: trigger.width, bottom: window.innerHeight - trigger.top + 4, maxHeight: Math.min(POPUP_MAX_HEIGHT, above) }
    : { left: trigger.left, width: trigger.width, top: trigger.bottom + 4, maxHeight: Math.min(POPUP_MAX_HEIGHT, below) }
}

export function Dropdown({ value, options, onChange, width = 160, small }: Props) {
  const [placement, setPlacement] = useState<Placement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const open = placement !== null
  const close = () => setPlacement(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      const target = e.target as Node
      if (!triggerRef.current?.contains(target) && !popupRef.current?.contains(target)) close()
    }
    const scrolledAway = (e: Event) => { if (!popupRef.current?.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', outside)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', scrolledAway, true)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', scrolledAway, true)
    }
  }, [open])

  const toggle = () => setPlacement(open ? null : placeBelowOrAbove(triggerRef.current!.getBoundingClientRect()))

  return (
    <div style={{ position: 'relative', width, flexShrink: 0 }}>
      <button ref={triggerRef} className="adw-btn" onClick={toggle} style={{
        width: '100%', minHeight: small ? 28 : 34, justifyContent: 'space-between',
        padding: '0 10px', fontWeight: 400, fontSize: small ? 12 : 14,
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        <CaretDown size={10} weight="bold" style={{ flexShrink: 0, color: 'var(--fg-dim)' }}/>
      </button>
      {placement && createPortal(
        <div ref={popupRef} style={{
          position: 'fixed', zIndex: 2000, ...placement,
          background: 'var(--popover)', borderRadius: 12, padding: 6, boxShadow: 'var(--shadow-popover)', overflowY: 'auto',
        }}>
          {options.map(opt => (
            <div key={opt} className="adw-row" onClick={() => { onChange(opt); close() }} style={{
              padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: small ? 12 : 14,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              {opt}
              {opt === value && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓</span>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
