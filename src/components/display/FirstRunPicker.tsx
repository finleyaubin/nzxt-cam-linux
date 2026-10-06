import { useMemo } from 'react'
import { PRESETS, DisplayConfig } from '@shared/display'
import { TemplateThumb } from './TemplateGallery'

/**
 * "Pick a look" overlay for an empty scene / first run. Render it over the editor.
 * - onPick(config): user chose a template; apply it
 * - onSkip(): user wants to start from a blank scene
 * - accent: highlight colour
 */
export function FirstRunPicker({ accent, onPick, onSkip }: {
  accent: string
  onPick: (config: DisplayConfig) => void
  onSkip: () => void
}) {
  const options = useMemo(() => PRESETS.slice(0, 4).map(p => ({ id: p.id, name: p.name, description: p.description, config: p.build() })), [])
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20, background: '#000d', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto',
    }}>
      <div style={{ maxWidth: 640, width: '100%', background: '#111', border: '1px solid #222', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#eee' }}>Pick a look</div>
        <div style={{ fontSize: 12, color: '#888', margin: '4px 0 14px' }}>Choose a starting point. You can change everything afterwards.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
          {options.map(o => (
            <button key={o.id} onClick={() => onPick(o.config)} style={{
              padding: 8, background: '#0d0d0d', border: '1px solid #222', borderRadius: 10, cursor: 'pointer', textAlign: 'left', color: '#c0c0c0',
            }}>
              <TemplateThumb config={o.config}/>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>{o.name}</div>
              <div style={{ fontSize: 10, color: '#7f7f7f', marginTop: 2 }}>{o.description}</div>
            </button>
          ))}
        </div>
        <button onClick={onSkip} style={{ marginTop: 14, background: 'none', border: 'none', color: accent, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          Start with a blank scene
        </button>
      </div>
    </div>
  )
}
