import { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'

interface Props {
  title: string
  onClose: () => void
  /** Sits between the title and the close button, e.g. a search box. */
  headerExtra?: ReactNode
  footer?: ReactNode
  /** Runs before the built-in Escape handling. */
  onKeyDown?: (e: React.KeyboardEvent) => void
  width?: number
  height?: number
  children: ReactNode
}

/** Centred popup over a dimmed backdrop. Keys stay inside it so editor shortcuts (Delete, arrows) can't fire behind it. */
export function Modal({ title, onClose, headerExtra, footer, onKeyDown, width = 780, height = 580, children }: Props) {
  return createPortal(
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => { onKeyDown?.(e); if (e.key === 'Escape') onClose(); e.stopPropagation() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} style={{
        width: `min(${width}px, 100%)`, height: `min(${height}px, 100%)`, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12, boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid #222' }}>
          <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{title}</div>
          {headerExtra ?? <div style={{ flex: 1 }}/>}
          <button onClick={onClose} aria-label="Close" style={{ display: 'flex', padding: 6, borderRadius: 8, border: '1px solid #252525', background: '#111', color: '#9a9a9a', cursor: 'pointer' }}><X size={13}/></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 12, padding: '8px 14px', borderTop: '1px solid #222', fontSize: 11, color: '#7f7f7f' }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
