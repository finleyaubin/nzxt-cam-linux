import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, MagnifyingGlass } from '@phosphor-icons/react'
import { api } from '../../lib/api'
import { Field } from './fields'
import { useLanguage } from '../../i18n/LangContext'

const MAX_ROWS = 200

let families: Promise<string[]> | null = null
const installedFonts = () => (families ??= api.listFonts().catch(() => []))

const quoted = (name: string) => `"${name.replace(/"/g, '')}", sans-serif`

function searchFonts(fonts: string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return fonts
  const first = words[0]
  const hits = fonts.filter(f => words.every(w => f.toLowerCase().includes(w)))
  return [...hits.filter(f => f.toLowerCase().startsWith(first)), ...hits.filter(f => !f.toLowerCase().startsWith(first))]
}

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
  const [highlighted, setHighlighted] = useState(0)
  const [installed, setInstalled] = useState<string[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const highlightedRow = useRef<HTMLDivElement>(null)

  useEffect(() => { installedFonts().then(setInstalled) }, [])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  useEffect(() => { highlightedRow.current?.scrollIntoView({ block: 'nearest' }) }, [highlighted, open])

  const matches = useMemo(() => searchFonts(installed ?? [], query), [installed, query])
  const rows: (string | null)[] = useMemo(
    () => [...(query.trim() ? [] : [null]), ...matches.slice(0, MAX_ROWS)],
    [matches, query],
  )
  const missing = !!value && installed !== null && !installed.includes(value)

  const close = () => { setOpen(false); setQuery('') }
  const pick = (font: string | null) => { close(); onChange(font) }
  const search = (text: string) => { setQuery(text); setHighlighted(0) }

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(rows.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' && rows.length > 0) { e.preventDefault(); pick(rows[highlighted]) }
    else if (e.key === 'Escape') { e.stopPropagation(); close() }
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
            <div style={{ position: 'relative', marginBottom: 6 }}>
              <MagnifyingGlass size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-dim)' }}/>
              <input autoFocus value={query} onChange={e => search(e.target.value)} onKeyDown={onSearchKey}
                placeholder={t('font.search')} aria-label={t('font.search_label')}
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--hover)', border: 'none', borderRadius: 6, fontSize: 13, padding: '6px 8px 6px 28px' }}/>
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {rows.map((font, i) => (
                <div key={font ?? 'default'} ref={i === highlighted ? highlightedRow : undefined}
                  onClick={() => pick(font)} onMouseMove={() => setHighlighted(i)}
                  style={{
                    padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: font ? 15 : 13, fontStyle: font ? undefined : 'italic',
                    fontFamily: font ? quoted(font) : undefined, fontWeight: font === (value ?? null) ? 700 : 400,
                    background: i === highlighted ? 'var(--selected)' : 'transparent',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{font ?? defaultLabel}</div>
              ))}
              {installed === null && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-dim)' }}>{t('font.loading')}</div>}
              {installed !== null && matches.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-dim)' }}>{t('font.no_matches')}</div>}
              {matches.length > MAX_ROWS && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-dim)' }}>{t('font.showing', { shown: MAX_ROWS, total: matches.length })}</div>}
            </div>
          </div>
        )}
      </div>
    </Field>
  )
}
