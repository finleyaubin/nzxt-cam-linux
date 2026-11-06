import { useApp } from '../context/AppContext'
import { api } from '../lib/api'
import { Minus, X } from '@phosphor-icons/react'
import { useLanguage } from '../i18n/LangContext'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function AppHeader() {
  const { state } = useApp()
  const { t } = useLanguage()
  const { deviceStatus } = state

  return (
    <header style={{
      height: 46, minHeight: 46, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
      padding: '0 6px 0 12px', background: 'var(--headerbar)', boxShadow: '0 1px 0 var(--border)', ...drag,
    }}>
      <div/>
      <div style={{ textAlign: 'center', lineHeight: 1.15 }}>
        <div style={{ fontWeight: 700 }}>NZXT CAM</div>
        <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>
          {deviceStatus.connected ? deviceStatus.productName : t('common.not_connected')}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, ...noDrag }}>
        <WinBtn title={t('window.minimize')} onClick={() => api.hideWindow()}><Minus size={14} weight="bold"/></WinBtn>
        <WinBtn title={t('window.quit')} onClick={() => api.quitApp()}><X size={14} weight="bold"/></WinBtn>
      </div>
    </header>
  )
}

function WinBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return <button className="adw-btn circular flat" onClick={onClick} title={title} aria-label={title} style={{ width: 28, minHeight: 28 }}>{children}</button>
}
