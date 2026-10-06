import { useEffect, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { SystemLogo, api } from '../../lib/api'
import { Modal } from '../ui/Modal'

/** Popup listing logos found on this machine (distro, desktop, hardware); picking one hands back its file path. */
export function LogoDialog({ accent, onPick, onClose }: { accent: string; onPick: (path: string) => void; onClose: () => void }) {
  const [logos, setLogos] = useState<SystemLogo[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => { api.listSystemLogos().then(setLogos).catch(() => setLogos([])) }, [])

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = (logos ?? []).filter(l => tokens.every(t => `${l.label} ${l.group}`.toLowerCase().includes(t)))
  const groups = [...new Set(shown.map(l => l.group))].map(group => [group, shown.filter(l => l.group === group)] as const)
  const message = (text: string) => <div style={{ padding: 24, fontSize: 12, color: '#9a9a9a', lineHeight: 1.6 }}>{text}</div>

  return (
    <Modal
      title="Add a logo" width={720} height={560} onClose={onClose}
      headerExtra={(
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#0d0d0d', border: '1px solid #252525', borderRadius: 8, padding: '0 10px' }}>
          <MagnifyingGlass size={13} color="#7f7f7f"/>
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search logos…" aria-label="Search logos"
            style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: '#e0e0e0', fontSize: 12, padding: '7px 0' }}/>
        </div>
      )}
      footer={<span style={{ flex: 1 }}>Found on this system for your distribution, desktop and hardware. Drop your own PNG or SVG files into <code>~/.config/nzxtcam-archlinux-rust/logos</code> to list them here.</span>}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 12px' }}>
        {logos === null ? message('Looking for logos on this system…')
          : logos.length === 0 ? message('No logos were found for your distribution, desktop or hardware. Drop PNG or SVG files into ~/.config/nzxtcam-archlinux-rust/logos to list your own, or use Image to pick a file.')
          : shown.length === 0 ? message('No logos match.')
          : groups.map(([group, list]) => (
            <div key={group}>
              <div style={{ padding: '12px 2px 6px', fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>{group} · {list.length}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                {list.map(logo => (
                  <button key={logo.path} onClick={() => onPick(logo.path)} title={logo.path}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, border: '1px solid #222', background: '#101010', cursor: 'pointer', color: '#b8b8b8', minWidth: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = accent }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#222' }}>
                    <div style={{ width: '100%', aspectRatio: '1', display: 'grid', placeItems: 'center', background: '#1b1b1b', borderRadius: 8 }}>
                      <img src={logo.thumb} alt="" draggable={false} style={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }}/>
                    </div>
                    <span style={{ fontSize: 11, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{logo.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </Modal>
  )
}
