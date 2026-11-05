import { useEffect, useRef, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { api } from '../../lib/api'
import { Field } from './fields'
import { useLanguage } from '../../i18n/LangContext'

const MAX_ROWS = 200

let families: Promise<string[]> | null = null
const installedFonts = () => (families ??= api.listFonts().catch(() => []))

const quoted = (name: string) => `"${name.replace(/"/g, '')}", sans-serif`

interface Props {
  /** Chosen family, or null for the default. */
  value: string | null | undefined
  /** What null means here, e.g. "Default" or "Scene font". */
  defaultLabel: string
  accent: string
  onChange: (font: string | null) => void
}

/** Searchable list of installed fonts, each shown in its own typeface. */
export function FontPicker({ value, defaultLabel, onChange }: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [installed, setInstalled] = useState<string[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { installedFonts().then(setInstalled) }, [])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const q = query.trim().toLowerCase()
  const matches = (installed ?? []).filter(f => !q || f.toLowerCase().includes(q))
  const missing = !!value && installed !== null && !installed.includes(value)

  const pick = (font: string | null) => { setOpen(false); setQuery(''); onChange(font) }
  const row = (key: string, label: string, font: string | null, style?: React.CSSProperties) => {
    const active = font === (value ?? null)
    return (
      <div key={key} onClick={() => pick(font)} style={{
        padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: active ? 700 : 400,
        background: active ? 'var(--selected)' : 'transparent', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...style,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--hover)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>{label}</div>
    )
  }

  return (
    <Field label={t('font.label')}>
      <div ref={ref} style={{ position: 'relative', width: '100%' }}>
        <div onClick={() => setOpen(o => !o)} style={{
          background: 'var(--hover)', borderRadius: 6, height: 28, padding: '0 28px 0 10px',
          cursor: 'pointer', fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', position: 'relative', userSelect: 'none',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: value ? quoted(value) : undefined }}>
            {value ?? defaultLabel}
          </span>
          {missing && <span style={{ marginLeft: 6, fontSize: 11, color: '#f5c211', flexShrink: 0 }}>{t('font.not_installed')}</span>}
          <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-dim)', display: 'flex' }}><CaretDown size={10}/></span>
        </div>
        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--popover)',
            borderRadius: 12, padding: 6, zIndex: 400, boxShadow: 'var(--shadow-popover)',
          }}>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t('font.search')} aria-label={t('font.search_label')}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--hover)', border: 'none', borderRadius: 6, color: 'var(--fg)', fontSize: 13, padding: '5px 8px', marginBottom: 4 }}/>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {!q && row('default', defaultLabel, null, { fontSize: 12, fontStyle: 'italic' })}
              {matches.slice(0, MAX_ROWS).map(f => row(f, f, f, { fontFamily: quoted(f) }))}
              {installed === null && <div style={{ padding: 10, fontSize: 11, color: 'var(--fg-dim)' }}>{t('font.loading')}</div>}
              {installed !== null && matches.length === 0 && <div style={{ padding: 10, fontSize: 11, color: 'var(--fg-dim)' }}>{t('font.no_matches')}</div>}
              {matches.length > MAX_ROWS && <div style={{ padding: 10, fontSize: 11, color: 'var(--fg-dim)' }}>{t('font.showing', { shown: MAX_ROWS, total: matches.length })}</div>}
            </div>
          </div>
        )}
      </div>
    </Field>
  )
}
