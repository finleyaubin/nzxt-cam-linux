import { BarElement, DisplayElement, GaugeElement, GraphElement, MAX_SENSORS, MetricId, TEXT_VARIABLES, TextElement, defaultWarnAt } from '@shared/display'
import { CheckField, ColorField, NumField, Pill, SectionTitle, SelectField, TextField } from './fields'
import { MetricOption, optionFor } from './metrics'
import { SensorPicker } from './SensorPicker'
import { CenterAxis } from './geometry'
import { useState } from 'react'
import { ArrowDown, ArrowUp, Copy, Trash } from '@phosphor-icons/react'

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

const TYPE_NAME: Record<DisplayElement['type'], string> = { gauge: 'Gauge', bar: 'Bar', graph: 'Graph', text: 'Text' }

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
  const current = optionFor(metrics, el.metric)
  const pickMetric = (m: { id: MetricId; label: string; max: number }) =>
    set({ metric: m.id, max: m.max, label: m.label, warnAt: defaultWarnAt(m.id, m.max) })
  return (
    <>
      <SensorPicker value={el.metric} currentLabel={current.label} accent={accent} onPick={pickMetric}
        builtins={metrics.filter(m => !m.id.startsWith('sensor'))}/>
      <TextField label="Label" value={el.label} onChange={label => set({ label })} maxLength={24}/>
      <CheckField label="Show label" checked={el.showLabel} accent={accent} onChange={showLabel => set({ showLabel })}/>
      <CheckField label="Show value" checked={el.showValue} accent={accent} onChange={showValue => set({ showValue })}/>
    </>
  )
}

function ScaleFields({ el, accent, set }: { el: Reading; accent: string; set: (p: Partial<Reading>) => void }) {
  return (
    <>
      <NumField label="Full scale" value={el.max} min={1} max={10000} accent={accent} onChange={max => set({ max })}/>
      <NumField label="Alert at" value={el.warnAt} min={0} max={10000} accent={accent} onChange={warnAt => set({ warnAt })}/>
      <ColorField label="Alert colour" value={el.warnColor} onChange={warnColor => set({ warnColor })}/>
      <ColorField label={el.type === 'graph' ? 'Panel' : 'Track'} value={el.trackColor} onChange={trackColor => set({ trackColor })}/>
    </>
  )
}

function GradientField({ el, accent, set }: { el: GaugeElement | BarElement; accent: string; set: (p: Partial<Reading>) => void }) {
  const on = !!el.gradientTo
  return (
    <CheckField label="Gradient" checked={on} accent={accent} onChange={v => set({ gradientTo: v ? '#00bcd4' : null })}>
      {on && (
        <label style={{ position: 'relative', width: 22, height: 22, cursor: 'pointer' }} title="Gradient end colour">
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: el.gradientTo ?? '#00bcd4', boxShadow: '0 0 0 2px #0d0d0d, 0 0 0 3px #2a2a2a' }}/>
          <input type="color" value={el.gradientTo ?? '#00bcd4'} onChange={e => set({ gradientTo: e.target.value })}
            aria-label="Gradient end colour" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}/>
        </label>
      )}
    </CheckField>
  )
}

function TextFields({ el, metrics, accent, set }: { el: TextElement; metrics: MetricOption[]; accent: string; set: (p: Partial<TextElement>) => void }) {
  const variables = [
    ...TEXT_VARIABLES.slice(0, 4),
    ...metrics.filter(m => m.id.startsWith('sensor')).map(m => ({ token: `{${m.id}}`, label: m.label })),
    ...TEXT_VARIABLES.slice(4),
  ]
  return (
    <>
      <TextField label="Text" value={el.text} onChange={text => set({ text })} placeholder="Type text, add variables below"/>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 102 }}>
        {variables.map(v => (
          <Pill key={v.token} accent={accent} title={`Insert ${v.token}`} onClick={() => set({ text: el.text + v.token })}>{v.label}</Pill>
        ))}
      </div>
      <div style={{ fontSize: 10, color: '#7f7f7f', paddingLeft: 102, lineHeight: 1.5 }}>
        Variables update live. Add <code>:1</code> for decimals, e.g. <code>{'{cpu:1}'}</code>. Up to {MAX_SENSORS} bound sensors are available as <code>{'{sensor1}'}</code>…
      </div>
      <NumField label="Size" value={el.size} min={8} max={200} unit="px" accent={accent} onChange={size => set({ size })}/>
      <SelectField label="Align" value={el.align} accent={accent} onChange={align => set({ align: align as TextElement['align'] })}
        options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]}/>
      <ColorField label="Colour" value={el.color} onChange={color => set({ color })}/>
    </>
  )
}

const ADV_KEY = 'inspector.advancedOpen'

/** Collapsible section for rarely-changed options; open state is remembered. */
function Advanced({ children }: { children: React.ReactNode }) {
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
      }}>{open ? '▾' : '▸'} Advanced</button>
      {open && children}
    </>
  )
}

export function ElementInspector({ element, metrics, accent, onChange, onRemove, onDuplicate, onCenter, onReorder }: Props) {
  const set = onChange as (p: Record<string, unknown>) => void

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>
          {element.type === 'gauge' ? (element.sweep >= 360 ? 'Ring' : 'Gauge') : TYPE_NAME[element.type]}
        </div>
        <IconButton title="Bring forward" onClick={() => onReorder(1)}><ArrowUp size={13}/></IconButton>
        <IconButton title="Send backward" onClick={() => onReorder(-1)}><ArrowDown size={13}/></IconButton>
        <IconButton title="Duplicate (Ctrl+D)" onClick={onDuplicate}><Copy size={13}/></IconButton>
        <IconButton title="Delete (Del)" onClick={onRemove} danger><Trash size={13}/></IconButton>
      </div>

      {element.type !== 'text' && (
        <>
          <SectionTitle>Reading</SectionTitle>
          <ReadingFields el={element} metrics={metrics} accent={accent} set={set}/>
          <ColorField label="Colour" value={element.color} onChange={color => set({ color })}/>
        </>
      )}

      <SectionTitle>Size &amp; position</SectionTitle>
      <NumField label="X" value={element.x} min={0} max={640} accent={accent} onChange={x => set({ x })}/>
      <NumField label="Y" value={element.y} min={0} max={640} accent={accent} onChange={y => set({ y })}/>
      <div style={{ display: 'flex', gap: 5, paddingLeft: 102 }}>
        <Pill accent={accent} onClick={() => onCenter('x')} title="Centre horizontally on the screen">Centre ↔</Pill>
        <Pill accent={accent} onClick={() => onCenter('y')} title="Centre vertically on the screen">Centre ↕</Pill>
      </div>
      {element.type === 'gauge' && (
        <>
          <NumField label="Radius" value={element.radius} min={20} max={320} unit="px" accent={accent} onChange={radius => set({ radius })}/>
          <NumField label="Thickness" value={element.thickness} min={4} max={160} unit="px" accent={accent} onChange={thickness => set({ thickness })}/>
          <NumField label="Text size" value={element.valueSize} min={8} max={160} unit="px" accent={accent} onChange={valueSize => set({ valueSize })}/>
        </>
      )}
      {element.type === 'bar' && (
        <>
          <NumField label="Width" value={element.width} min={40} max={640} unit="px" accent={accent} onChange={width => set({ width })}/>
          <NumField label="Height" value={element.height} min={6} max={160} unit="px" accent={accent} onChange={height => set({ height })}/>
          <NumField label="Text size" value={element.valueSize} min={8} max={160} unit="px" accent={accent} onChange={valueSize => set({ valueSize })}/>
        </>
      )}
      {element.type === 'graph' && (
        <>
          <NumField label="Width" value={element.width} min={90} max={640} unit="px" accent={accent} onChange={width => set({ width })}/>
          <NumField label="Height" value={element.height} min={60} max={640} unit="px" accent={accent} onChange={height => set({ height })}/>
          <NumField label="Text size" value={element.valueSize} min={8} max={80} unit="px" accent={accent} onChange={valueSize => set({ valueSize })}/>
        </>
      )}

      {element.type !== 'text' && (
        <Advanced>
          {element.type === 'gauge' && (
            <>
              <NumField label="Start angle" value={element.startAngle} min={-180} max={180} unit="°" accent={accent} onChange={startAngle => set({ startAngle })}/>
              <NumField label="Sweep" value={element.sweep} min={30} max={360} unit="°" accent={accent} onChange={sweep => set({ sweep })}/>
              <NumField label="Corners" value={element.cornerRadius ?? 0} min={0} max={80} unit="px" accent={accent} onChange={cornerRadius => set({ cornerRadius })}/>
            </>
          )}
          {element.type === 'bar' && (
            <>
              <NumField label="Corners" value={element.cornerRadius ?? element.height / 2} min={0} max={80} unit="px" accent={accent} onChange={cornerRadius => set({ cornerRadius })}/>
              <NumField label="Segments" value={element.segments ?? 0} min={0} max={30} accent={accent} onChange={segments => set({ segments })}/>
            </>
          )}
          {element.type === 'graph' && (
            <>
              <NumField label="History" value={element.windowSecs} min={10} max={600} unit="s" accent={accent} onChange={windowSecs => set({ windowSecs: Math.round(windowSecs) })}/>
              <NumField label="Line width" value={element.lineWidth} min={1} max={12} unit="px" accent={accent} onChange={lineWidth => set({ lineWidth })}/>
              <NumField label="Corners" value={element.cornerRadius} min={0} max={80} unit="px" accent={accent} onChange={cornerRadius => set({ cornerRadius })}/>
              <CheckField label="Fill" checked={element.fill} accent={accent} onChange={fill => set({ fill })}/>
            </>
          )}
          <ScaleFields el={element} accent={accent} set={set}/>
          {element.type !== 'graph' && <GradientField el={element} accent={accent} set={set}/>}
        </Advanced>
      )}
      {element.type === 'text' && (
        <>
          <SectionTitle>Content</SectionTitle>
          <TextFields el={element} metrics={metrics} accent={accent} set={set}/>
        </>
      )}
    </div>
  )
}
