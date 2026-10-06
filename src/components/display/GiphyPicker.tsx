import { useState, useEffect, FormEvent } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { api } from '../../lib/api'
import { Modal } from '../ui/Modal'

interface GiphyRendition { url: string }
interface GiphyGif {
  id: string
  title: string
  images: {
    fixed_width: GiphyRendition
    downsized_medium?: GiphyRendition
    original: GiphyRendition
  }
}
interface GiphyPage { data: GiphyGif[]; pagination: { total_count: number } }

type Status = 'idle' | 'searching' | 'downloading' | 'error'

const PAGE_SIZE = 36

/** Popup that searches GIPHY and hands back the path of the downloaded GIF. */
export function GiphyDialog({ accent, onPick, onClose }: { accent: string; onPick: (path: string) => void; onClose: () => void }) {
  const [apiKey, setApiKey] = useState<string | null | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<GiphyGif[] | null>(null)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { api.getSettings().then(s => setApiKey(s.apiKeys?.giphy || null)) }, [])

  const fetchPage = async (q: string, offset: number): Promise<GiphyPage> => {
    const params = new URLSearchParams({ api_key: apiKey!, q, limit: String(PAGE_SIZE), offset: String(offset), rating: 'pg-13' })
    const res = await fetch(`https://api.giphy.com/v1/gifs/search?${params}`)
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'GIPHY rejected the API key' : `GIPHY error ${res.status}`)
    return res.json()
  }

  const load = async (q: string, offset: number) => {
    setStatus('searching')
    setError(null)
    try {
      const page = await fetchPage(q, offset)
      setTerm(q)
      setTotal(page.pagination.total_count)
      setResults(prev => (offset === 0 ? page.data : [...(prev ?? []), ...page.data]))
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const search = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim().slice(0, 50)
    if (apiKey && q) load(q, 0)
  }

  const pick = async (gif: GiphyGif) => {
    setStatus('downloading')
    setError(null)
    try {
      const url = (gif.images.downsized_medium ?? gif.images.original).url
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      onPick(await api.saveGiphyGif(gif.id, await res.arrayBuffer()))
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = status === 'searching' || status === 'downloading'
  const message = (text: string) => <div style={{ padding: 24, fontSize: 12, color: '#9a9a9a', lineHeight: 1.6 }}>{text}</div>
  const footerStatus = error ? error : status === 'downloading' ? 'Downloading GIF…' : results ? `${results.length} of ${total} for “${term}”` : ''

  return (
    <Modal
      title="Search GIPHY" width={860} height={640} onClose={onClose}
      headerExtra={apiKey ? (
        <form onSubmit={search} style={{ flex: 1, display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#0d0d0d', border: '1px solid #252525', borderRadius: 8, padding: '0 10px' }}>
            <MagnifyingGlass size={13} color="#7f7f7f"/>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search GIPHY…" aria-label="Search GIPHY"
              style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: '#e0e0e0', fontSize: 12, padding: '7px 0' }}/>
          </div>
          <button type="submit" disabled={busy} style={{
            padding: '0 14px', borderRadius: 8, border: 'none', background: accent, color: '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
          }}>{status === 'searching' ? 'Searching…' : 'Search'}</button>
        </form>
      ) : undefined}
      footer={(
        <>
          <span style={{ flex: 1, color: error ? '#ff4757' : undefined }}>{footerStatus}</span>
          <span>Powered by GIPHY</span>
        </>
      )}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        {apiKey === undefined ? null
          : !apiKey ? message('Add your GIPHY API key in Settings, under API keys, to search GIFs here.')
          : !results ? message('Search for a looping GIF to use as the screen background.')
          : results.length === 0 ? message(`No GIFs found for “${term}”.`)
          : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, alignContent: 'start' }}>
                {results.map(gif => (
                  <button key={gif.id} onClick={() => pick(gif)} disabled={status === 'downloading'} title={gif.title} style={{
                    position: 'relative', width: '100%', height: 0, padding: '0 0 100%', border: '1px solid #1e1e1e', borderRadius: 8,
                    overflow: 'hidden', background: '#111', cursor: 'pointer', opacity: status === 'downloading' ? 0.5 : 1,
                  }}>
                    <img src={gif.images.fixed_width.url} alt={gif.title} loading="lazy"
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/>
                  </button>
                ))}
              </div>
              {results.length < total && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 4px' }}>
                  <button onClick={() => load(term, results.length)} disabled={busy} style={{
                    padding: '7px 16px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: '#b8b8b8', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                  }}>{status === 'searching' ? 'Loading…' : 'Load more'}</button>
                </div>
              )}
            </>
          )}
      </div>
    </Modal>
  )
}
