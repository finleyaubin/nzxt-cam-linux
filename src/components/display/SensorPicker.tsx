import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { MAX_SENSORS, MetricId } from '@shared/display'
import { Sensor } from '../../lib/api'
import { bindSensor, useBoundSources, useSensorCatalog } from '../../hooks/useSensorSlots'
import { Modal } from '../ui/Modal'
import { useLanguage } from '../../i18n/LangContext'
import type { TranslationKey } from '../../i18n/languages'
import { Field, Pill } from './fields'
import { MetricOption } from './metrics'

const BUILTIN = 'Built-in'
const IN_USE = 'In use'
const SOURCES = [BUILTIN, 'System', 'NVIDIA GPU', 'Hardware', 'Home Assistant']
const MAX_ROWS = 150

const SOURCE_LABELS: Record<string, TranslationKey> = {
  [BUILTIN]: 'sensor_picker.source.builtin',
  [IN_USE]: 'sensor_picker.source.in_use',
  System: 'sensor_picker.source.system',
  'NVIDIA GPU': 'sensor_picker.source.nvidia',
  Hardware: 'sensor_picker.source.hardware',
  'Home Assistant': 'sensor_picker.source.home_assistant',
}

const sourceOf = (id: string) =>
  id.startsWith('ha:') ? 'Home Assistant' : id.startsWith('sys:') ? 'System' : id.startsWith('nvidia-smi:') ? 'NVIDIA GPU' : 'Hardware'

const shortLabel = (label: string) => label.replace(/^(Home Assistant|System) · /, '')

function highlight(text: string, tokens: string[]): ReactNode {
  if (!tokens.length) return text
  const re = new RegExp(`(${tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return text.split(re).map((part, i) => i % 2 ? <mark key={i} style={{ background: 'none', color: '#fff', fontWeight: 700 }}>{part}</mark> : part)
}

interface Row {
  key: string
  label: string
  /** Secondary line, e.g. the Home Assistant entity id. */
  sub: string
  unit: string
  source: string
  bound: boolean
  active: boolean
  builtin?: MetricOption
  sensor?: Sensor
}

interface DialogProps {
  title: string
  /** Limit the list, e.g. to sensors not yet bound. */
  only?: (s: Sensor) => boolean
  builtins: MetricOption[]
  /** Metric currently shown, so its row is marked. */
  activeId?: MetricId
  accent: string
  onBuiltin: (b: MetricOption) => void
  /** Resolve with an error message to keep the dialog open and show it. */
  onSensor: (s: Sensor) => Promise<string | void>
  onClose: () => void
}

/** Popup with search, source/unit filters and a keyboard-navigable list of every sensor. */
export function SensorDialog({ title, only, builtins, activeId, accent, onBuiltin, onSensor, onClose }: DialogProps) {
  const { t } = useLanguage()
  const everything = useSensorCatalog()
  const catalog = only ? everything.filter(only) : everything
  const boundSources = useBoundSources()
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [unit, setUnit] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [error, setError] = useState('')
  const hotRef = useRef<HTMLDivElement>(null)
  useEffect(() => setCursor(0), [query, source, unit])
  useEffect(() => hotRef.current?.scrollIntoView({ block: 'nearest' }), [cursor])

  const activeSource = activeId?.startsWith('sensor') ? boundSources[Number(activeId.slice(6)) - 1] : null
  const rows = useMemo<Row[]>(() => [
    ...builtins.map(b => ({ key: b.id, label: b.label, sub: '', unit: b.unit, source: BUILTIN, bound: false, active: b.id === activeId, builtin: b })),
    ...catalog.map(s => ({
      key: s.id, label: shortLabel(s.label), sub: s.id.startsWith('ha:') ? s.id.slice(3) : '', unit: s.unit, source: sourceOf(s.id),
      bound: boundSources.includes(s.id), active: s.id === activeSource, sensor: s,
    })),
  ], [builtins, catalog, boundSources, activeId, activeSource])

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (text: string) => tokens.every(t => text.toLowerCase().includes(t))

  const sourceCounts = SOURCES.map(name => [name, rows.filter(r => r.source === name).length] as const).filter(([, n]) => n > 0)
  const inUseCount = rows.filter(r => r.bound).length
  const inSource = rows.filter(r => !source || (source === IN_USE ? r.bound : r.source === source))
  const unitCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of inSource) if (r.unit) counts.set(r.unit, (counts.get(r.unit) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])
  }, [inSource])

  const found = inSource.filter(r => (!unit || r.unit === unit) && matches(`${r.label} ${r.sub}`))
  const pinned = !query && !source && !unit
  const inUse = pinned ? found.filter(r => r.bound) : []
  const shown = (pinned ? found.filter(r => !r.bound) : found).slice(0, MAX_ROWS)
  const groups: (readonly [string, Row[]])[] = [
    ...(inUse.length ? [[IN_USE, inUse] as const] : []),
    ...SOURCES.map(name => [name, shown.filter(r => r.source === name)] as const).filter(([, list]) => list.length),
  ]
  const flat = groups.flatMap(([, list]) => list)

  const pick = async (row: Row | undefined) => {
    if (!row) return
    if (row.builtin) { onBuiltin(row.builtin); onClose(); return }
    const failure = await onSensor(row.sensor!)
    if (failure) setError(failure)
    else onClose()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(flat[cursor]) }
  }

  const filterItem = (key: string, label: string, count: number, active: boolean, onClick: () => void) => (
    <div key={key} onClick={onClick} style={{
      display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
      color: active ? accent : 'var(--fg)', background: active ? `${accent}1a` : 'transparent',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: '#6f6f6f' }}>{count}</span>
    </div>
  )
  const filterHead = (t: string) => <div style={{ padding: '10px 10px 4px', fontSize: 11, color: 'var(--fg-dim)', fontWeight: 700 }}>{t}</div>

  let index = 0
  const renderRow = (r: Row, showBadge: boolean) => {
    const i = index++
    const hot = i === cursor
    return (
      <div key={r.key} ref={hot ? hotRef : undefined} title={r.sensor?.id ?? r.label} onClick={() => pick(r)} onMouseMove={() => setCursor(i)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
        background: hot ? 'rgba(255,255,255,0.07)' : r.active ? `${accent}1a` : 'transparent',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: r.active ? accent : 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{highlight(r.label, tokens)}</div>
          {r.sub && <div style={{ fontSize: 11, color: '#6f6f6f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{highlight(r.sub, tokens)}</div>}
        </div>
        {showBadge && r.bound && <span style={{ fontSize: 11, color: accent }}>{t('sensor_picker.in_use_badge')}</span>}
        {r.unit && <span style={{ fontSize: 11, color: 'var(--fg-dim)', minWidth: 28, textAlign: 'right' }}>{r.unit}</span>}
      </div>
    )
  }

  return (
    <Modal
      title={title} onClose={onClose} onKeyDown={onKeyDown}
      headerExtra={(
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--window)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px' }}>
          <MagnifyingGlass size={13} color="var(--fg-dim)"/>
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t('sensor_picker.search')} aria-label={t('sensor_picker.search_label')}
            style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: 'var(--fg)', fontSize: 12, padding: '7px 0' }}/>
        </div>
      )}
      footer={(
        <>
          <span style={{ flex: 1, color: error ? '#f66151' : undefined }}>{error || t('sensor_picker.keys_hint')}</span>
          <span>{t('sensor_picker.slots_in_use', { used: boundSources.filter(Boolean).length, total: MAX_SENSORS })}</span>
        </>
      )}
    >
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ width: 190, flexShrink: 0, overflowY: 'auto', padding: '2px 8px 10px', borderRight: '1px solid var(--border)' }}>
          {filterHead(t('sensor_picker.filter_source'))}
          {filterItem('all', t('sensor_picker.all'), rows.length, !source, () => { setSource(null); setUnit(null) })}
          {inUseCount > 0 && filterItem(IN_USE, t('sensor_picker.in_use_on_lcd'), inUseCount, source === IN_USE, () => { setSource(source === IN_USE ? null : IN_USE); setUnit(null) })}
          {sourceCounts.map(([name, n]) => filterItem(name, t(SOURCE_LABELS[name]), n, source === name, () => { setSource(source === name ? null : name); setUnit(null) }))}
          {unitCounts.length > 1 && filterHead(t('sensor_picker.filter_unit'))}
          {unitCounts.length > 1 && filterItem('any-unit', t('sensor_picker.any_unit'), inSource.length, !unit, () => setUnit(null))}
          {unitCounts.length > 1 && unitCounts.map(([u, n]) => filterItem(u, u, n, unit === u, () => setUnit(unit === u ? null : u)))}
        </div>

        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '4px 8px 10px' }}>
          {groups.map(([name, list]) => (
            <div key={name}>
              <div style={{ padding: '10px 10px 4px', fontSize: 11, color: 'var(--fg-dim)', fontWeight: 700 }}>{t(SOURCE_LABELS[name])} · {list.length}</div>
              {list.map(r => renderRow(r, name !== IN_USE))}
            </div>
          ))}
          {flat.length === 0 && <div style={{ padding: 16, fontSize: 12, color: 'var(--fg-dim)' }}>{everything.length === 0 ? t('sensor_picker.loading') : t('sensor_picker.no_match')}</div>}
          {found.length > MAX_ROWS && <div style={{ padding: '10px', fontSize: 11, color: 'var(--fg-dim)' }}>{t('sensor_picker.showing', { shown: MAX_ROWS, total: found.length })}</div>}
        </div>
      </div>
    </Modal>
  )
}

interface Props {
  value: MetricId
  /** Label of the current value. */
  currentLabel: string
  /** Built-in readings (cpu/gpu/liquid/pump). */
  builtins: MetricOption[]
  accent: string
  onPick: (m: { id: MetricId; label: string; max: number }) => void
}

/** Select-style button that opens the sensor popup; picking an unbound sensor binds it to a free slot automatically. */
export function SensorPicker({ value, currentLabel, builtins, accent, onPick }: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Field label={t('sensor_picker.shows')}>
        <div onClick={() => setOpen(true)} style={{
          flex: 1, background: 'var(--border)', border: `1px solid ${open ? accent : 'var(--border)'}`, borderRadius: 8, height: 28, padding: '0 28px 0 10px',
          cursor: 'pointer', fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', position: 'relative', userSelect: 'none', minWidth: 0,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentLabel}</span>
          <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-dim)', display: 'flex' }}><CaretDown size={10}/></span>
        </div>
      </Field>
      {open && (
        <SensorDialog title={t('sensor_picker.choose_shows')} builtins={builtins} activeId={value} accent={accent} onClose={() => setOpen(false)}
          onBuiltin={b => onPick({ id: b.id, label: b.label, max: b.max })}
          onSensor={async s => {
            const res = await bindSensor(s)
            if (!res.ok) return t(res.error, { max: MAX_SENSORS })
            onPick({ id: res.metric, label: s.label.replace(/\s*\(.*\)$/, ''), max: res.max })
          }}/>
      )}
    </>
  )
}

/** "+ Sensor" button for text elements: pick any reading in the popup and hand back its `{variable}` token. */
export function InsertSensor({ builtins, accent, onInsert }: { builtins: MetricOption[]; accent: string; onInsert: (token: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)

  return (
    <div style={{ paddingLeft: 102 }}>
      <Pill active={open} accent={accent} onClick={() => setOpen(true)} title={t('sensor_picker.insert_tip')}><Plus size={10}/> {t('sensor_picker.insert_button')}</Pill>
      {open && (
        <SensorDialog title={t('sensor_picker.insert_title')} builtins={builtins} accent={accent} onClose={() => setOpen(false)}
          onBuiltin={b => onInsert(`{${b.id}}`)}
          onSensor={async s => {
            const res = await bindSensor(s)
            if (!res.ok) return t(res.error, { max: MAX_SENSORS })
            onInsert(`{${res.metric}}`)
          }}/>
      )}
    </div>
  )
}
