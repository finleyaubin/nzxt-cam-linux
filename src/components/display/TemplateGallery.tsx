import { useEffect, useRef, useState } from 'react'
import { api, SavedLayout } from '../../lib/api'
import { PRESETS, DisplayConfig } from '@shared/display'

/** Preview image of a config, rendered by the backend only once the card scrolls into view. */
export function TemplateThumb({ config }: { config: DisplayConfig }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      api.renderDisplayPreview(config).then(r => { if (alive && r.success && r.dataUrl) setSrc(r.dataUrl) }).catch(() => {})
    })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [config])
  return (
    <div ref={ref} style={{ aspectRatio: '1', borderRadius: '50%', background: '#0a0a0f', overflow: 'hidden' }}>
      {src && <img src={src} alt="" style={{ width: '100%', height: '100%', display: 'block' }}/>}
    </div>
  )
}

/**
 * Gallery of built-in presets and the user's saved layouts.
 * - current: the config being edited (saved by "Save current look")
 * - onPick(config): user chose a template; the caller applies it
 * - onSaveCurrent?(name): if given, shows a name field + save button; the gallery calls
 *   api.saveLayout itself, then onSaveCurrent lets the caller react (e.g. toast)
 * - accent: highlight colour
 */
export function TemplateGallery({ current, accent, onPick, onSaveCurrent }: {
  current: DisplayConfig
  accent: string
  onPick: (config: DisplayConfig) => void
  onSaveCurrent?: (name: string) => void
}) {
  const [saved, setSaved] = useState<SavedLayout[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reload = () => api.listLayouts().then(setSaved).catch(() => {})
  useEffect(() => { reload() }, [])

  const save = async () => {
    const n = name.trim()
    if (!n) return
    try {
      await api.saveLayout(n, current)
      setName(''); setError(null)
      onSaveCurrent?.(n)
      reload()
    } catch (e) { setError(String(e)) }
  }
  const remove = async (n: string) => { await api.deleteLayout(n).catch(() => {}); reload() }

  const card = (key: string, title: string, sub: string | undefined, config: DisplayConfig, onDelete?: () => void) => (
    <div key={key} style={{ position: 'relative' }}>
      <button onClick={() => onPick(config)} style={{
        width: '100%', padding: 8, background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 10,
        cursor: 'pointer', textAlign: 'left', color: '#c0c0c0',
      }}>
        <TemplateThumb config={config}/>
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>{title}</div>
        {sub && <div style={{ fontSize: 10, color: '#7f7f7f', marginTop: 2 }}>{sub}</div>}
      </button>
      {onDelete && (
        <button onClick={onDelete} aria-label={`Delete ${title}`} style={{
          position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, border: 'none',
          background: '#000a', color: '#ccc', cursor: 'pointer', fontSize: 12, lineHeight: '22px', padding: 0,
        }}>×</button>
      )}
    </div>
  )
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 } as const
  const heading = (s: string) => <div style={{ fontSize: 11, fontWeight: 700, color: '#777', margin: '14px 0 8px', textTransform: 'uppercase', letterSpacing: 0.6 }}>{s}</div>

  return (
    <div>
      {onSaveCurrent && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="Name this look" style={{ flex: 1, padding: '7px 10px', background: '#0d0d0d', border: '1px solid #222', borderRadius: 8, color: '#ddd', fontSize: 12 }}/>
          <button onClick={save} disabled={!name.trim()} style={{
            padding: '7px 14px', borderRadius: 8, border: `1px solid ${accent}55`, background: `${accent}18`,
            color: accent, fontSize: 12, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'default', opacity: name.trim() ? 1 : 0.5,
          }}>Save current look</button>
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: '#e5484d', marginTop: 6 }}>{error}</div>}
      {saved.length > 0 && <>
        {heading('Your layouts')}
        <div style={grid}>{saved.map(l => card(`s:${l.name}`, l.name, undefined, l.config, () => remove(l.name)))}</div>
      </>}
      {heading('Templates')}
      <div style={grid}>{PRESETS.map(p => card(p.id, p.name, p.description, p.build()))}</div>
    </div>
  )
}
