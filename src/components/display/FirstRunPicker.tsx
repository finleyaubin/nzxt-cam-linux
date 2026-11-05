import { useMemo } from 'react'
import { PRESETS, DisplayConfig } from '@shared/display'
import { TemplateThumb } from './TemplateGallery'
import { useLanguage } from '../../i18n/LangContext'

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
  const { t } = useLanguage()
  const options = useMemo(() => PRESETS.slice(0, 4).map(p => ({ id: p.id, name: t(p.nameKey), description: t(p.descriptionKey), config: p.build() })), [t])
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20, background: '#000d', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto',
    }}>
      <div style={{ maxWidth: 640, width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#eee' }}>{t('first_run.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-dim)', margin: '4px 0 14px' }}>{t('first_run.desc')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
          {options.map(o => (
            <button key={o.id} onClick={() => onPick(o.config)} style={{
              padding: 8, background: 'var(--window)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', textAlign: 'left', color: 'var(--fg)',
            }}>
              <TemplateThumb config={o.config}/>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>{o.name}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 2 }}>{o.description}</div>
            </button>
          ))}
        </div>
        <button onClick={onSkip} style={{ marginTop: 14, background: 'none', border: 'none', color: accent, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          {t('first_run.blank')}
        </button>
      </div>
    </div>
  )
}
