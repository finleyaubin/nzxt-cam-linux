import { useApp } from '../context/AppContext'
import { api } from '../lib/api'
import { Minus, X } from '@phosphor-icons/react'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function AppHeader() {
  const { state } = useApp()
  const { accent, deviceStatus } = state

  return (
    <div style={{
      height: 42, minHeight: 42,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px 0 14px',
      background: '#090909',
      borderBottom: '1px solid #161616',
      ...drag,
    }}>
      {/* Left: device pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...noDrag }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '3px 10px', borderRadius: 20,
          background: deviceStatus.connected ? `${accent}14` : '#1a1a1a',
          border: `1px solid ${deviceStatus.connected ? `${accent}33` : '#252525'}`,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: deviceStatus.connected ? accent : '#3a3a3a',
            boxShadow: deviceStatus.connected ? `0 0 6px ${accent}` : 'none',
          }}/>
          <span style={{ fontSize: 11, color: deviceStatus.connected ? '#c0c0c0' : '#3a3a3a', fontWeight: 600 }}>
            {deviceStatus.connected ? deviceStatus.productName : 'Not connected'}
          </span>
        </div>
      </div>

      {/* Right: window controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...noDrag }}>
        <WinBtn title="Minimize" onClick={() => api.hideWindow()}>
          <Minus size={13} weight="regular" />
        </WinBtn>
        <WinBtn title="Quit" onClick={() => api.quitApp()} danger>
          <X size={12} weight="regular" />
        </WinBtn>
      </div>
    </div>
  )
}

function WinBtn({ onClick, title, children, danger }: { onClick: () => void; title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7f7f7f', transition: 'all 130ms' }}
      onMouseEnter={e => {
        const b = e.currentTarget as HTMLButtonElement
        b.style.background = danger ? '#ff475720' : '#1e1e1e'
        b.style.color = danger ? '#ff4757' : '#888'
      }}
      onMouseLeave={e => {
        const b = e.currentTarget as HTMLButtonElement
        b.style.background = 'transparent'
        b.style.color = '#7f7f7f'
      }}
    >
      {children}
    </button>
  )
}
