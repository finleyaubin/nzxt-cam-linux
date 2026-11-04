import { useEffect, useState } from 'react'
import { DisplayConfig, DisplayElement } from '@shared/display'
import { api } from '../../lib/api'
import { useLanguage } from '../../i18n/LangContext'
import { ColorField, Field, NumField, Pill, SectionTitle } from './fields'
import { FontPicker } from './FontPicker'
import { GiphyDialog } from './GiphyPicker'
import { ThemePicker } from './ThemePicker'
import { TemplateGallery } from './TemplateGallery'
import { Gif, ImageSquare, X } from '@phosphor-icons/react'

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

interface Props {
  config: DisplayConfig
  accent: string
  onChange: (patch: Partial<DisplayConfig>) => void
  /** A template or saved layout was picked; replaces the current layout. */
  onLayout: (config: DisplayConfig) => void
  /** Called by the theme picker with the restyled elements (+ new background colour when no image is set); owner should apply both in one editScene. */
  onRestyle: (elements: DisplayElement[], background?: string) => void
}

/** Settings for the screen as a whole, shown when no element is selected. */
export function ScenePanel({ config, accent, onChange, onLayout, onRestyle }: Props) {
  const { t } = useLanguage()
  const [rotation, setRotation] = useState(0)
  const [showGiphy, setShowGiphy] = useState(false)
  const image = config.backgroundImage ?? null

  useEffect(() => { api.getLcdOrientation().then(setRotation) }, [])

  const rotate = async (deg: number) => {
    const res = await api.setLcdOrientation(deg)
    if (res.success) setRotation(deg)
  }

  const pickImage = async () => {
    const path = await api.openFileDialog([{ name: t('scene.photo_gif_filter'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }])
    if (path) onChange({ backgroundImage: path })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{t('scene.title')}</div>
      <div style={{ fontSize: 11, color: '#7f7f7f', lineHeight: 1.5 }}>
        {t('scene.help')}
      </div>

      <SectionTitle>{t('scene.theme')}</SectionTitle>
      <ThemePicker config={config} accent={accent} onRestyle={onRestyle}/>

      <SectionTitle>{t('scene.text')}</SectionTitle>
      <FontPicker value={config.font} defaultLabel={t('scene.font_default')} accent={accent} onChange={font => onChange({ font })}/>

      <SectionTitle>{t('scene.background')}</SectionTitle>
      <ColorField label={t('scene.colour')} value={config.background} onChange={background => onChange({ background })}/>
      <Field label={t('scene.photo_gif')}>
        <Pill accent={accent} active={!!image} onClick={pickImage}>
          <ImageSquare size={13}/>
          <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image ? fileName(image) : t('scene.choose')}</span>
        </Pill>
        <Pill accent={accent} active={showGiphy} onClick={() => setShowGiphy(true)}><Gif size={13}/>GIPHY</Pill>
        {image && (
          <button onClick={() => onChange({ backgroundImage: null })} aria-label={t('scene.remove_background')} style={{
            display: 'flex', padding: 5, borderRadius: 8, border: '1px solid #252525', background: 'transparent', color: '#9a9a9a', cursor: 'pointer',
          }}><X size={12}/></button>
        )}
      </Field>
      {showGiphy && <GiphyDialog accent={accent} onClose={() => setShowGiphy(false)} onPick={path => { onChange({ backgroundImage: path }); setShowGiphy(false) }}/>}
      {image && (
        <>
          <NumField label={t('scene.dim')} value={config.backgroundDim ?? 0} min={0} max={90} unit="%" accent={accent} onChange={backgroundDim => onChange({ backgroundDim: Math.round(backgroundDim) })}/>
          {image.toLowerCase().endsWith('.gif') && (
            <div style={{ fontSize: 10, color: '#7f7f7f', lineHeight: 1.5 }}>
              {t('scene.gif_note')}
            </div>
          )}
        </>
      )}

      <SectionTitle>{t('scene.mounting')}</SectionTitle>
      <Field label={t('scene.rotation')}>
        {[0, 90, 180, 270].map(deg => <Pill key={deg} active={rotation === deg} accent={accent} onClick={() => rotate(deg)}>{deg}°</Pill>)}
      </Field>

      <SectionTitle>{t('scene.templates_section')}</SectionTitle>
      <TemplateGallery current={config} accent={accent} onPick={onLayout} onSaveCurrent={name => { api.saveLayout(name, config) }}/>
    </div>
  )
}
