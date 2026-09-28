import { useApp } from '../../context/AppContext'
import { Card } from '../ui/Card'
import { LCDCircularPreview } from '../ui/LCDCircularPreview'
import { MediaUploader } from '../MediaUploader'
import { TempDisplayConfig } from '../display/TempDisplayConfig'
import { GiphyPicker } from '../display/GiphyPicker'
import { LCDPreview } from '../LCDPreview'
import { api } from '../../lib/api'
import { useState } from 'react'
import { Temperatures } from '../../lib/api'
import { Monitor, Image, Gif, Thermometer, Play, Check } from '@phosphor-icons/react'

function LivePreview({ applied, temperatures }: {
  applied: { mode: 'image' | 'gif' | 'temperatures'; url?: string } | null
  temperatures: Temperatures
}) {
  if (!applied) {
    return (
      <div style={{
        width: 200, height: 200, borderRadius: '50%', background: '#080808',
        border: '1px solid #1e1e1e', boxShadow: '0 0 0 4px #111, 0 0 0 5px #1a1a1a',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <Monitor size={28} weight="regular" color="#7f7f7f" />
        <span style={{ fontSize: 10, color: '#7f7f7f', fontWeight: 500 }}>Not found</span>
      </div>
    )
  }

  if (applied.mode === 'temperatures') {
    return <LCDCircularPreview temp={temperatures.liquid} source="Liquid" showLogo={true}/>
  }

  if (applied.url) {
    return (
      <div style={{
        width: 200, height: 200, borderRadius: '50%', overflow: 'hidden',
        border: '1px solid #1e1e1e', boxShadow: '0 0 0 4px #111, 0 0 0 5px #1a1a1a',
      }}>
        <img src={applied.url} alt="LCD" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
      </div>
    )
  }

  return (
    <div style={{
      width: 200, height: 200, borderRadius: '50%', background: '#080808',
      border: '1px solid #1e1e1e', boxShadow: '0 0 0 4px #111, 0 0 0 5px #1a1a1a',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
    }}>
      <span style={{ fontSize: 10, color: '#7f7f7f' }}>Not found</span>
    </div>
  )
}

const IImage = () => <Image size={14} weight="regular" />
const IGif = () => <Gif size={14} weight="regular" />
const IThermo = () => <Thermometer size={14} weight="regular" />

const MODES = [
  { id: 'image',        label: 'Image',        Icon: IImage  },
  { id: 'gif',          label: 'GIF',           Icon: IGif    },
  { id: 'temperatures', label: 'Temperatures',  Icon: IThermo },
] as const

export function LCDScreen() {
  const { state, dispatch } = useApp()
  const { accent, temperatures, currentMode, deviceStatus } = state
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  const handleApply = async () => {
    if (!deviceStatus.connected || applying) return
    setApplying(true)
    try {
      if (currentMode === 'temperatures') {
        await api.startTempMode()
        dispatch({ type: 'SET_LCD_APPLIED', payload: { mode: 'temperatures' } })
      } else if (currentMode === 'image' && state.currentImagePath) {
        await api.sendImage(state.currentImagePath)
        dispatch({ type: 'SET_LCD_APPLIED', payload: { mode: 'image', url: state.imagePreviewUrl ?? undefined } })
      } else if (currentMode === 'gif' && state.currentGifPath) {
        await api.sendGif(state.currentGifPath)
        dispatch({ type: 'SET_LCD_APPLIED', payload: { mode: 'gif', url: state.gifPreviewUrl ?? undefined } })
      }
      setApplied(true)
      setTimeout(() => setApplied(false), 3000)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>LCD Display</div>

      <div style={{ display: 'grid', gridTemplateColumns: currentMode === 'temperatures' ? '1fr' : '1fr 260px', gap: 18, alignItems: 'start' }}>
        {/* Left: main content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Mode selector */}
          <Card style={{ padding: '14px 18px' }} accent={accent}>
            <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12, fontWeight: 700 }}>Display mode</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {MODES.map(({ id, label, Icon }) => (
                <button key={id} onClick={() => dispatch({ type: 'SET_MODE', payload: id })} style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 8,
                  border: `1px solid ${currentMode === id ? `${accent}55` : '#252525'}`,
                  background: currentMode === id ? `${accent}14` : '#111',
                  color: currentMode === id ? accent : '#555',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 140ms',
                }}>
                  <Icon/>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </Card>

          {state.error && (
            <div style={{ background: '#ff475718', border: '1px solid #ff4757', borderRadius: 8, padding: '9px 13px', color: '#ff4757', fontSize: 12 }}>
              {state.error}
            </div>
          )}

          {/* Screen content */}
          {currentMode === 'temperatures' ? (
            <TempDisplayConfig/>
          ) : (
            <Card style={{ padding: 20 }} accent={accent}>
              <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14, fontWeight: 700 }}>LCD content</div>
              <div style={{ display: 'flex', gap: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <LCDPreview/>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <MediaUploader/>
                  {currentMode === 'gif' && (
                    <GiphyPicker accent={accent} onPick={path => {
                      dispatch({ type: 'SET_GIF_PATH', payload: path })
                      dispatch({ type: 'SET_GIF_PREVIEW', payload: api.fileUrl(path) })
                    }}/>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Apply button */}
          {currentMode !== 'temperatures' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={handleApply} disabled={!deviceStatus.connected || applying} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                background: deviceStatus.connected ? accent : '#252525',
                border: 'none', color: deviceStatus.connected ? '#fff' : '#444',
                borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700,
                cursor: deviceStatus.connected ? 'pointer' : 'not-allowed',
                boxShadow: deviceStatus.connected ? `0 0 16px ${accent}44` : 'none',
                transition: 'all 140ms',
              }}>
                <Play size={13} weight="fill" />
                {applying ? 'Sending…' : applied ? 'Applied to LCD' : 'Apply to LCD'}
              </button>
              {applied && <Check size={11} weight="regular" color="#00e87a" />}
              {!deviceStatus.connected && <span style={{ fontSize: 11, color: '#ffb347' }}>Device not connected</span>}
            </div>
          )}
        </div>

        {/* Right: preview + info — hidden in temperatures mode (TempDisplayConfig has its own) */}
        {currentMode !== 'temperatures' && <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }} accent={accent}>
            <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}>Live Preview</div>
            <LivePreview applied={state.lcdApplied} temperatures={temperatures}/>
            <div style={{ fontSize: 10, color: '#7f7f7f', fontFamily: 'JetBrains Mono, monospace' }}>480 × 480 px</div>
          </Card>

          <Card style={{ padding: 16 }} accent={accent}>
            <div style={{ fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 12, fontWeight: 700 }}>Display Info</div>
            {[
              { label: 'Resolution', val: '480 × 480' },
              { label: 'Interface',  val: 'USB Direct' },
              { label: 'Brightness', val: '100%' },
              { label: 'Status',     val: deviceStatus.connected ? deviceStatus.productName : 'Not connected' },
            ].map(({ label, val }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#7f7f7f' }}>{label}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#888' }}>{val}</span>
              </div>
            ))}
          </Card>
        </div>}
      </div>
    </div>
  )
}
