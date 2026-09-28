import { useState, useEffect, FormEvent } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { api } from '../../lib/api'

interface GiphyRendition { url: string }
interface GiphyGif {
  id: string
  title: string
  images: {
    fixed_width_small: GiphyRendition
    downsized_medium?: GiphyRendition
    original: GiphyRendition
  }
}

type Status = 'idle' | 'searching' | 'downloading' | 'error'

export function GiphyPicker({ accent, onPick }: { accent: string; onPick: (path: string) => void }) {
  const [apiKey, setApiKey] = useState<string | null | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GiphyGif[] | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { api.getSettings().then(s => setApiKey(s.apiKeys?.giphy || null)) }, [])

  const search = async (e: FormEvent) => {
    e.preventDefault()
    if (!apiKey || !query.trim()) return
    setStatus('searching')
    setError(null)
    try {
      const params = new URLSearchParams({ api_key: apiKey, q: query.trim().slice(0, 50), limit: '24', rating: 'pg-13' })
      const res = await fetch(`https://api.giphy.com/v1/gifs/search?${params}`)
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'GIPHY rejected the API key' : `GIPHY error ${res.status}`)
      setResults((await res.json()).data)
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const pick = async (gif: GiphyGif) => {
    setStatus('downloading')
    setError(null)
    try {
      const url = (gif.images.downsized_medium ?? gif.images.original).url
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      onPick(await api.saveGiphyGif(gif.id, await res.arrayBuffer()))
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (apiKey === undefined) return null
  if (!apiKey) {
    return (
      <div style={{ fontSize: 12, color: '#9a9a9a', padding: '10px 12px', border: '1px dashed #2a2a2a', borderRadius: 8 }}>
        Add your GIPHY API key in Settings, under API keys, to search GIFs here.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <form onSubmit={search} style={{ display: 'flex', gap: 6 }}>
        <input
          value={query} onChange={e => setQuery(e.target.value)} placeholder="Search GIPHY" aria-label="Search GIPHY"
          style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#0d0d0d', color: '#e0e0e0', fontSize: 12 }}
        />
        <button type="submit" disabled={status === 'searching'} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: 'none',
          background: accent, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}>
          <MagnifyingGlass size={13}/>
          {status === 'searching' ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <div style={{ fontSize: 11, color: '#ff4757' }}>{error}</div>}
      {status === 'downloading' && <div style={{ fontSize: 11, color: '#9a9a9a' }}>Downloading GIF…</div>}
      {results?.length === 0 && <div style={{ fontSize: 11, color: '#9a9a9a' }}>No GIFs found for "{query}".</div>}

      {results && results.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
          {results.map(gif => (
            <button key={gif.id} onClick={() => pick(gif)} disabled={status === 'downloading'} title={gif.title} style={{
              padding: 0, border: '1px solid #1e1e1e', borderRadius: 8, overflow: 'hidden', background: '#111',
              cursor: 'pointer', aspectRatio: '1', opacity: status === 'downloading' ? 0.5 : 1,
            }}>
              <img src={gif.images.fixed_width_small.url} alt={gif.title} loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/>
            </button>
          ))}
        </div>
      )}

      <div style={{ fontSize: 10, color: '#7f7f7f', alignSelf: 'flex-end' }}>Powered by GIPHY</div>
    </div>
  )
}
