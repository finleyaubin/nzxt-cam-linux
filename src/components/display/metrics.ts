import { useSensorSlots } from '../../hooks/useSensorSlots'
import { BaseMetric, MetricId, metricLabel, metricMax, isBaseMetric } from '@shared/display'

export interface MetricOption {
  id: MetricId
  label: string
  unit: string
  /** Full-scale value for gauges, bars and graphs. */
  max: number
}

const BASE: Record<BaseMetric, { label: string; unit: string }> = {
  cpu:    { label: 'CPU',    unit: '°'   },
  gpu:    { label: 'GPU',    unit: '°'   },
  liquid: { label: 'Liquid', unit: '°'   },
  pump:   { label: 'Pump',   unit: 'RPM' },
}

/** Everything an element can display: the built-in readings plus the sensors bound in Settings. */
export function useMetricOptions(): MetricOption[] {
  const sensors = useSensorSlots()
  return [
    ...(Object.keys(BASE) as BaseMetric[]).map(id => ({ id, ...BASE[id], max: metricMax(id) })),
    ...sensors.map(s => ({ id: s.metric, label: s.label, unit: s.unit, max: s.max })),
  ]
}

export function optionFor(options: MetricOption[], id: MetricId): MetricOption {
  return options.find(o => o.id === id)
    ?? { id, label: isBaseMetric(id) ? metricLabel(id) : `${metricLabel(id)} (not set)`, unit: '', max: metricMax(id) }
}
