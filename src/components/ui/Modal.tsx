import { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import { useLanguage } from '../../i18n/LangContext'

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
  const { t } = useLanguage()
  return createPortal(
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => { onKeyDown?.(e); if (e.key === 'Escape') onClose(); e.stopPropagation() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        background: 'rgba(0,0,0,0.4)',
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} style={{
        width: `min(${width}px, 100%)`, height: `min(${height}px, 100%)`, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'var(--popover)', borderRadius: 12, boxShadow: 'var(--shadow-popover)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px 8px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>{title}</div>
          {headerExtra ?? <div style={{ flex: 1 }}/>}
          <button className="adw-btn circular flat" onClick={onClose} aria-label={t('common.close')} style={{ width: 28, minHeight: 28 }}><X size={14} weight="bold"/></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 12, padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--fg-dim)' }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
