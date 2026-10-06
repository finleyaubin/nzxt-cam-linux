import { useEffect, useState } from 'react'
import { DisplayConfig, PRESETS, Preset } from '@shared/display'
import { api } from '../../lib/api'
import { ColorField, Field, NumField, Pill, SectionTitle } from './fields'
import { GiphyPicker } from './GiphyPicker'
import { Gif, ImageSquare, X } from '@phosphor-icons/react'

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

interface Props {
  config: DisplayConfig
  accent: string
  onChange: (patch: Partial<DisplayConfig>) => void
  onTemplate: (preset: Preset) => void
}

/** Settings for the screen as a whole, shown when no element is selected. */
export function ScenePanel({ config, accent, onChange, onTemplate }: Props) {
  const [rotation, setRotation] = useState(0)
  const [showGiphy, setShowGiphy] = useState(false)
  const image = config.backgroundImage ?? null

  useEffect(() => { api.getLcdOrientation().then(setRotation) }, [])

  const rotate = async (deg: number) => {
    const res = await api.setLcdOrientation(deg)
    if (res.success) setRotation(deg)
  }

  const pickImage = async () => {
    const path = await api.openFileDialog([{ name: 'Photo or GIF', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }])
    if (path) onChange({ backgroundImage: path })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Screen</div>
      <div style={{ fontSize: 11, color: '#7f7f7f', lineHeight: 1.5 }}>
        Add elements with the buttons above, drag them on the preview and pull the handles to resize. Pick an element to edit it.
      </div>

      <SectionTitle>Background</SectionTitle>
      <ColorField label="Colour" value={config.background} onChange={background => onChange({ background })}/>
      <Field label="Photo / GIF">
        <Pill accent={accent} active={!!image} onClick={pickImage}>
          <ImageSquare size={13}/>
          <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image ? fileName(image) : 'Choose…'}</span>
        </Pill>
        <Pill accent={accent} active={showGiphy} onClick={() => setShowGiphy(v => !v)}><Gif size={13}/>GIPHY</Pill>
        {image && (
          <button onClick={() => onChange({ backgroundImage: null })} aria-label="Remove background image" style={{
            display: 'flex', padding: 5, borderRadius: 8, border: '1px solid #252525', background: 'transparent', color: '#9a9a9a', cursor: 'pointer',
          }}><X size={12}/></button>
        )}
      </Field>
      {showGiphy && <GiphyPicker accent={accent} onPick={path => { onChange({ backgroundImage: path }); setShowGiphy(false) }}/>}
      {image && (
        <>
          <NumField label="Dim image" value={config.backgroundDim ?? 0} min={0} max={90} unit="%" accent={accent} onChange={backgroundDim => onChange({ backgroundDim: Math.round(backgroundDim) })}/>
          {image.toLowerCase().endsWith('.gif') && (
            <div style={{ fontSize: 10, color: '#7f7f7f', lineHeight: 1.5 }}>
              GIFs animate on the cooler. Readings refresh every 1-5s depending on GIF length; the preview shows the first frame.
            </div>
          )}
        </>
      )}

      <SectionTitle>Cooler mounting</SectionTitle>
      <Field label="Rotation">
        {[0, 90, 180, 270].map(deg => <Pill key={deg} active={rotation === deg} accent={accent} onClick={() => rotate(deg)}>{deg}°</Pill>)}
      </Field>

      <SectionTitle>Start from a template</SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {PRESETS.map(p => <Pill key={p.id} accent={accent} title={`${p.description}. Replaces the current layout (Ctrl+Z to undo).`} onClick={() => onTemplate(p)}>{p.name}</Pill>)}
      </div>
    </div>
  )
}
