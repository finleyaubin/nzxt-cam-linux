import { useEffect, useRef, useState } from 'react'
import { api, SavedLayout } from '../../lib/api'
import { PRESETS, DisplayConfig } from '@shared/display'
import { useLanguage } from '../../i18n/LangContext'

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
  const { t } = useLanguage()
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
        width: '100%', padding: 8, background: 'var(--window)', border: '1px solid var(--border)', borderRadius: 10,
        cursor: 'pointer', textAlign: 'left', color: 'var(--fg)',
      }}>
        <TemplateThumb config={config}/>
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 2 }}>{sub}</div>}
      </button>
      {onDelete && (
        <button onClick={onDelete} aria-label={t('templates.delete', { name: title })} style={{
          position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, border: 'none',
          background: '#000a', color: '#ccc', cursor: 'pointer', fontSize: 12, lineHeight: '22px', padding: 0,
        }}>×</button>
      )}
    </div>
  )
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 } as const
  const heading = (s: string) => <div style={{ fontSize: 11, fontWeight: 700, color: '#777', margin: '14px 0 8px', letterSpacing: 0.6 }}>{s}</div>

  return (
    <div>
      {onSaveCurrent && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()}
            placeholder={t('templates.name_placeholder')} style={{ flex: 1, padding: '7px 10px', background: 'var(--window)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg)', fontSize: 12 }}/>
          <button onClick={save} disabled={!name.trim()} style={{
            padding: '7px 14px', borderRadius: 8, border: `1px solid ${accent}55`, background: `${accent}18`,
            color: accent, fontSize: 12, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'default', opacity: name.trim() ? 1 : 0.5,
          }}>{t('templates.save_current')}</button>
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: '#e5484d', marginTop: 6 }}>{error}</div>}
      {saved.length > 0 && <>
        {heading(t('templates.your_layouts'))}
        <div style={grid}>{saved.map(l => card(`s:${l.name}`, l.name, undefined, l.config, () => remove(l.name)))}</div>
      </>}
      {heading(t('templates.templates'))}
      <div style={grid}>{PRESETS.map(p => card(p.id, t(p.nameKey), t(p.descriptionKey), p.build()))}</div>
    </div>
  )
}
