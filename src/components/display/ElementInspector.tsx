import type { TranslationKey } from '../../i18n/languages'
import { useLanguage } from '../../i18n/LangContext'
import { BarElement, DisplayElement, GaugeElement, GraphElement, IMAGE_EXTENSIONS, ImageElement, MAX_SENSORS, MetricId, TEXT_VARIABLES, TextElement, defaultWarnAt } from '@shared/display'
import { CheckField, ColorField, Field, NumField, Pill, SectionTitle, SelectField, TextField } from './fields'
import { api } from '../../lib/api'
import { LogoDialog } from './LogoDialog'
import { MetricOption, optionFor } from './metrics'
import { InsertSensor, SensorPicker } from './SensorPicker'
import { FontPicker } from './FontPicker'
import { CenterAxis } from './geometry'
import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, ImageSquare, Trash } from '@phosphor-icons/react'

interface Props {
  element: DisplayElement
  metrics: MetricOption[]
  accent: string
  onChange: (patch: Partial<DisplayElement>) => void
  onRemove: () => void
  onDuplicate: () => void
  onCenter: (axis: CenterAxis) => void
  onReorder: (direction: 1 | -1) => void
}

type Reading = GaugeElement | BarElement | GraphElement

const TYPE_NAME: Record<DisplayElement['type'], TranslationKey> = {
  gauge: 'inspector.type.gauge', bar: 'inspector.type.bar', graph: 'inspector.type.graph', text: 'inspector.type.text', image: 'inspector.type.image',
}

function IconButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} style={{
      display: 'flex', padding: 7, borderRadius: 8, border: '1px solid #252525', background: '#111', cursor: 'pointer',
      color: '#9a9a9a',
    }}
    onMouseEnter={e => { e.currentTarget.style.color = danger ? '#ff4757' : '#fff' }}
    onMouseLeave={e => { e.currentTarget.style.color = '#9a9a9a' }}>{children}</button>
  )
}

/** Controls every metric-driven element (gauge, bar, graph) shares. */
function ReadingFields({ el, metrics, accent, set }: { el: Reading; metrics: MetricOption[]; accent: string; set: (p: Partial<Reading>) => void }) {
  const { t } = useLanguage()
  const current = optionFor(metrics, el.metric, t)
  const pickMetric = (m: { id: MetricId; label: string; max: number }) =>
    set({ metric: m.id, max: m.max, label: m.label, warnAt: defaultWarnAt(m.id, m.max) })
  return (
    <>
      <SensorPicker value={el.metric} currentLabel={current.label} accent={accent} onPick={pickMetric}
        builtins={metrics.filter(m => !m.id.startsWith('sensor'))}/>
      <TextField label={t('inspector.label')} value={el.label} onChange={label => set({ label })} maxLength={24}/>
      <CheckField label={t('inspector.show_label')} checked={el.showLabel} accent={accent} onChange={showLabel => set({ showLabel })}/>
      <CheckField label={t('inspector.show_value')} checked={el.showValue} accent={accent} onChange={showValue => set({ showValue })}/>
      {el.type === 'gauge' && (
        <SelectField label={t('inspector.text_position')} value={el.textPosition ?? 'center'} accent={accent}
          onChange={v => set({ textPosition: v as 'center' | 'bottom' })}
          options={[{ value: 'center', label: t('inspector.text_position_center') }, { value: 'bottom', label: t('inspector.text_position_bottom') }]}/>
      )}
    </>
  )
}

function ScaleFields({ el, defaultMax, accent, set }: { el: Reading; defaultMax: number; accent: string; set: (p: Partial<Reading>) => void }) {
  const { t } = useLanguage()
  return (
    <>
      <NumField label={t('inspector.full_scale')} value={el.max} min={1} max={10000} sliderMax={Math.max(defaultMax * 2, el.max)} accent={accent} onChange={max => set({ max })}/>
      <NumField label={t('inspector.alert_at')} value={el.warnAt} min={0} max={10000} sliderMax={Math.max(el.max, el.warnAt)} accent={accent} onChange={warnAt => set({ warnAt })}/>
      <ColorField label={t('inspector.alert_colour')} value={el.warnColor} onChange={warnColor => set({ warnColor })}/>
      <ColorField label={el.type === 'graph' ? t('inspector.panel') : t('inspector.track')} value={el.trackColor} onChange={trackColor => set({ trackColor })}/>
    </>
  )
}

function GradientField({ el, accent, set }: { el: GaugeElement | BarElement; accent: string; set: (p: Partial<Reading>) => void }) {
  const { t } = useLanguage()
  const on = !!el.gradientTo
  return (
    <CheckField label={t('inspector.gradient')} checked={on} accent={accent} onChange={v => set({ gradientTo: v ? '#00bcd4' : null })}>
      {on && (
        <label style={{ position: 'relative', width: 22, height: 22, cursor: 'pointer' }} title={t('inspector.gradient_end')}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: el.gradientTo ?? '#00bcd4', boxShadow: '0 0 0 2px #0d0d0d, 0 0 0 3px #2a2a2a' }}/>
          <input type="color" value={el.gradientTo ?? '#00bcd4'} onChange={e => set({ gradientTo: e.target.value })}
            aria-label={t('inspector.gradient_end')} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}/>
        </label>
      )}
    </CheckField>
  )
}

function TextFields({ el, metrics, accent, set }: { el: TextElement; metrics: MetricOption[]; accent: string; set: (p: Partial<TextElement>) => void }) {
  const { t } = useLanguage()
  const input = useRef<HTMLInputElement>(null)
  const insert = (token: string) => {
    const start = input.current?.selectionStart ?? el.text.length
    const end = input.current?.selectionEnd ?? start
    set({ text: el.text.slice(0, start) + token + el.text.slice(end) })
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  const usedSensors = [...new Set([...el.text.matchAll(/\{(sensor\d+)(?::\d)?\}/g)].map(m => m[1]))]
  return (
    <>
      <TextField label={t('inspector.text')} value={el.text} onChange={text => set({ text })} placeholder={t('inspector.text_placeholder')} inputRef={input}/>
      <InsertSensor accent={accent} builtins={metrics.filter(m => !m.id.startsWith('sensor'))} onInsert={insert}/>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 102 }}>
        {TEXT_VARIABLES.map(v => (
          <Pill key={v.token} accent={accent} title={t('variable.insert', { token: v.token, label: t(v.label) })} onClick={() => insert(v.token)}>{t(v.short)}</Pill>
        ))}
      </div>
      {usedSensors.length > 0 && (
        <div style={{ fontSize: 10, color: '#7f7f7f', paddingLeft: 102, lineHeight: 1.6 }}>
          {usedSensors.map(id => <div key={id}><code>{`{${id}}`}</code> {t('inspector.sensor_is', { label: metrics.find(m => m.id === id)?.label ?? t('inspector.not_set') })}</div>)}
        </div>
      )}
      <div style={{ fontSize: 10, color: '#7f7f7f', paddingLeft: 102, lineHeight: 1.5 }}>
        {t('inspector.variables_help', { max: MAX_SENSORS })}
      </div>
      <FontPicker value={el.font} defaultLabel={t('inspector.scene_font')} accent={accent} onChange={font => set({ font })}/>
      <NumField label={t('inspector.size')} value={el.size} min={8} max={200} unit="px" accent={accent} onChange={size => set({ size })}/>
      <SelectField label={t('inspector.align')} value={el.align} accent={accent} onChange={align => set({ align: align as TextElement['align'] })}
        options={[{ value: 'left', label: t('inspector.align_left') }, { value: 'center', label: t('inspector.align_centre') }, { value: 'right', label: t('inspector.align_right') }]}/>
      <ColorField label={t('inspector.colour')} value={el.color} onChange={color => set({ color })}/>
    </>
  )
}

function ImageFields({ el, accent, set }: { el: ImageElement; accent: string; set: (p: Partial<ImageElement>) => void }) {
  const { t } = useLanguage()
  const [picking, setPicking] = useState(false)
  const choose = async () => {
    const path = await api.openFileDialog([{ name: t('inspector.image_filter'), extensions: IMAGE_EXTENSIONS }])
    if (path) set({ path })
  }
  return (
    <>
      <Field label={t('inspector.file')}>
        <Pill accent={accent} onClick={choose}>
          <ImageSquare size={13}/>
          <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{el.path.split(/[\\/]/).pop() || t('inspector.choose')}</span>
        </Pill>
        <Pill accent={accent} onClick={() => setPicking(true)} title={t('inspector.logos_tip')}>{t('inspector.logos')}</Pill>
      </Field>
      {picking && <LogoDialog accent={accent} onClose={() => setPicking(false)} onPick={path => { set({ path }); setPicking(false) }}/>}
      <NumField label={t('inspector.opacity')} value={el.opacity} min={0} max={100} unit="%" accent={accent} onChange={opacity => set({ opacity: Math.round(opacity) })}/>
      <div style={{ fontSize: 10, color: '#7f7f7f', paddingLeft: 102, lineHeight: 1.5 }}>
        {t('inspector.image_note')}
      </div>
    </>
  )
}

const ADV_KEY = 'inspector.advancedOpen'

/** Collapsible section for rarely-changed options; open state is remembered. */
function Advanced({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(ADV_KEY) === '1' } catch { return false } })
  const toggle = () => {
    setOpen(!open)
    try { localStorage.setItem(ADV_KEY, open ? '0' : '1') } catch { /* storage unavailable */ }
  }
  return (
    <>
      <button onClick={toggle} aria-expanded={open} style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        fontSize: 10, color: '#7f7f7f', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700,
      }}>{open ? '▾' : '▸'} {t('inspector.advanced')}</button>
      {open && children}
    </>
  )
}

export function ElementInspector({ element, metrics, accent, onChange, onRemove, onDuplicate, onCenter, onReorder }: Props) {
  const { t } = useLanguage()
  const set = onChange as (p: Record<string, unknown>) => void

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>
          {t(element.type === 'gauge' ? (element.sweep >= 360 ? 'inspector.type.ring' : element.textPosition === 'bottom' ? 'inspector.type.split_ring' : 'inspector.type.gauge') : TYPE_NAME[element.type])}
        </div>
        <IconButton title={t('inspector.bring_forward')} onClick={() => onReorder(1)}><ArrowUp size={13}/></IconButton>
        <IconButton title={t('inspector.send_backward')} onClick={() => onReorder(-1)}><ArrowDown size={13}/></IconButton>
        <IconButton title={t('inspector.duplicate')} onClick={onDuplicate}><Copy size={13}/></IconButton>
        <IconButton title={t('inspector.delete')} onClick={onRemove} danger><Trash size={13}/></IconButton>
      </div>

      {element.type !== 'text' && element.type !== 'image' && (
        <>
          <SectionTitle>{t('inspector.reading')}</SectionTitle>
          <ReadingFields el={element} metrics={metrics} accent={accent} set={set}/>
          {element.type === 'gauge' && (
            <CheckField label={t('inspector.value_in_pill')} checked={!!element.valuePill} accent={accent} onChange={valuePill => set({ valuePill })}/>
          )}
          {element.type === 'gauge' && element.sweep < 360 && (
            <CheckField label={t('inspector.min_max')} checked={!!element.showRange} accent={accent} onChange={showRange => set({ showRange, ...(showRange && !element.rangeOffset && { rangeOffset: Math.round(element.thickness / 2 + 14) }) })}/>
          )}
          {element.type === 'gauge' && element.sweep < 360 && element.showRange && (
            <>
              <NumField label={t('inspector.label_angle')} value={element.rangeAngle ?? 0} min={-180} max={180} unit="°" accent={accent} onChange={rangeAngle => set({ rangeAngle })}/>
              <NumField label={t('inspector.label_offset')} value={element.rangeOffset ?? 0} min={0} max={200} unit="px" accent={accent} onChange={rangeOffset => set({ rangeOffset })}/>
            </>
          )}
          <ColorField label={t('inspector.colour')} value={element.color} onChange={color => set({ color })}/>
        </>
      )}

      <SectionTitle>{t('inspector.size_position')}</SectionTitle>
      <NumField label="X" value={element.x} min={0} max={640} accent={accent} onChange={x => set({ x })}/>
      <NumField label="Y" value={element.y} min={0} max={640} accent={accent} onChange={y => set({ y })}/>
      <div style={{ display: 'flex', gap: 5, paddingLeft: 102 }}>
        <Pill accent={accent} onClick={() => onCenter('x')} title={t('inspector.centre_h_tip')}>{t('inspector.centre_h')}</Pill>
        <Pill accent={accent} onClick={() => onCenter('y')} title={t('inspector.centre_v_tip')}>{t('inspector.centre_v')}</Pill>
      </div>
      {element.type === 'gauge' && (
        <>
          <NumField label={t('inspector.radius')} value={element.radius} min={20} max={320} unit="px" accent={accent} onChange={radius => set({ radius })}/>
          <NumField label={t('inspector.thickness')} value={element.thickness} min={4} max={160} unit="px" accent={accent} onChange={thickness => set({ thickness })}/>
          <NumField label={t('inspector.text_size')} value={element.valueSize} min={8} max={160} unit="px" accent={accent} onChange={valueSize => set({ valueSize })}/>
        </>
      )}
      {element.type === 'image' && (
        <>
          <NumField label={t('inspector.width')} value={element.width} min={16} max={640} unit="px" accent={accent} onChange={width => set({ width })}/>
          <NumField label={t('inspector.height')} value={element.height} min={16} max={640} unit="px" accent={accent} onChange={height => set({ height })}/>
        </>
      )}
      {element.type === 'bar' && (
        <>
          <NumField label={t('inspector.width')} value={element.width} min={40} max={640} unit="px" accent={accent} onChange={width => set({ width })}/>
          <NumField label={t('inspector.height')} value={element.height} min={6} max={160} unit="px" accent={accent} onChange={height => set({ height })}/>
          <NumField label={t('inspector.text_size')} value={element.valueSize} min={8} max={160} unit="px" accent={accent} onChange={valueSize => set({ valueSize })}/>
        </>
      )}
      {element.type === 'graph' && (
        <>
          <NumField label={t('inspector.width')} value={element.width} min={90} max={640} unit="px" accent={accent} onChange={width => set({ width })}/>
          <NumField label={t('inspector.height')} value={element.height} min={60} max={640} unit="px" accent={accent} onChange={height => set({ height })}/>
          <NumField label={t('inspector.text_size')} value={element.valueSize} min={8} max={80} unit="px" accent={accent} onChange={valueSize => set({ valueSize })}/>
        </>
      )}

      {element.type !== 'text' && element.type !== 'image' && (
        <Advanced>
          {element.type === 'gauge' && (
            <>
              <NumField label={t('inspector.start_angle')} value={element.startAngle} min={-180} max={180} unit="°" accent={accent} onChange={startAngle => set({ startAngle })}/>
              <NumField label={t('inspector.sweep')} value={element.sweep} min={30} max={360} unit="°" accent={accent} onChange={sweep => set({ sweep })}/>
              <NumField label={t('inspector.corners')} value={element.cornerRadius ?? 0} min={0} max={80} unit="px" accent={accent} onChange={cornerRadius => set({ cornerRadius })}/>
            </>
          )}
          {element.type === 'bar' && (
            <>
              <NumField label={t('inspector.corners')} value={element.cornerRadius ?? element.height / 2} min={0} max={80} unit="px" accent={accent} onChange={cornerRadius => set({ cornerRadius })}/>
              <NumField label={t('inspector.segments')} value={element.segments ?? 0} min={0} max={30} accent={accent} onChange={segments => set({ segments })}/>
            </>
          )}
          {element.type === 'graph' && (
            <>
              <NumField label={t('inspector.history')} value={element.windowSecs} min={10} max={600} unit="s" accent={accent} onChange={windowSecs => set({ windowSecs: Math.round(windowSecs) })}/>
              <NumField label={t('inspector.line_width')} value={element.lineWidth} min={1} max={12} unit="px" accent={accent} onChange={lineWidth => set({ lineWidth })}/>
              <NumField label={t('inspector.corners')} value={element.cornerRadius} min={0} max={80} unit="px" accent={accent} onChange={cornerRadius => set({ cornerRadius })}/>
              <CheckField label={t('inspector.fill')} checked={element.fill} accent={accent} onChange={fill => set({ fill })}/>
            </>
          )}
          <ScaleFields el={element} defaultMax={optionFor(metrics, element.metric, t).max} accent={accent} set={set}/>
          {element.type !== 'graph' && <GradientField el={element} accent={accent} set={set}/>}
        </Advanced>
      )}
      {element.type === 'image' && (
        <>
          <SectionTitle>{t('inspector.picture')}</SectionTitle>
          <ImageFields el={element} accent={accent} set={set}/>
        </>
      )}
      {element.type === 'text' && (
        <>
          <SectionTitle>{t('inspector.content')}</SectionTitle>
          <TextFields el={element} metrics={metrics} accent={accent} set={set}/>
        </>
      )}
    </div>
  )
}
