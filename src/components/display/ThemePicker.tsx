import { DisplayConfig, DisplayElement } from '@shared/display'
import { Pill } from './fields'

interface Theme { id: string; name: string; accent: string; track: string; text: string; alert: string; background: string }

export const THEMES: Theme[] = [
  { id: 'cyan',    name: 'Cyan',    accent: '#00bcd4', track: '#1a2a2e', text: '#ffffff', alert: '#ff4757', background: '#000000' },
  { id: 'purple',  name: 'Purple',  accent: '#9d4edd', track: '#241a30', text: '#f1e6ff', alert: '#ff6b81', background: '#08050d' },
  { id: 'ember',   name: 'Ember',   accent: '#ff8a3d', track: '#2e2018', text: '#fff1e6', alert: '#ff3b30', background: '#0a0604' },
  { id: 'matrix',  name: 'Matrix',  accent: '#2ee86b', track: '#122418', text: '#d8ffe4', alert: '#ffd23f', background: '#020a04' },
  { id: 'arctic',  name: 'Arctic',  accent: '#7fd4ff', track: '#1d2833', text: '#f2faff', alert: '#ff7a7a', background: '#05090d' },
  { id: 'mono',    name: 'Mono',    accent: '#e8e8e8', track: '#2a2a2a', text: '#ffffff', alert: '#ff4757', background: '#000000' },
]

/** Restyle every element (and the background, unless an image is set) with a theme. */
export function applyTheme(theme: Theme, config: DisplayConfig): { elements: DisplayElement[]; background?: string } {
  const elements = config.elements.map((el): DisplayElement => el.type === 'text'
    ? { ...el, color: theme.text }
    : { ...el, color: theme.accent, trackColor: theme.track, warnColor: theme.alert, ...(el.type !== 'graph' ? { gradientTo: null } : {}) } as DisplayElement)
  return config.backgroundImage ? { elements } : { elements, background: theme.background }
}

export function ThemePicker({ config, accent, onRestyle }: { config: DisplayConfig; accent: string; onRestyle: (elements: DisplayElement[], background?: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {THEMES.map(t => (
        <Pill key={t.id} accent={accent} title={`Apply the ${t.name} colours to every element`}
          onClick={() => { const r = applyTheme(t, config); onRestyle(r.elements, r.background) }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.accent, boxShadow: `0 0 0 2px ${t.track}` }}/>{t.name}
        </Pill>
      ))}
    </div>
  )
}
