import { useSensorSlots } from '../../hooks/useSensorSlots'
import { useLanguage } from '../../i18n/LangContext'
import type { TranslationKey, Translate } from '../../i18n/languages'
import { BaseMetric, MetricId, metricLabel, metricMax, isBaseMetric } from '@shared/display'

export interface MetricOption {
  id: MetricId
  label: string
  unit: string
  /** Full-scale value for gauges, bars and graphs. */
  max: number
}

const BASE: Record<BaseMetric, { label: TranslationKey; unit: string }> = {
  cpu:    { label: 'metric.cpu',    unit: '°'   },
  gpu:    { label: 'metric.gpu',    unit: '°'   },
  liquid: { label: 'metric.liquid', unit: '°'   },
  pump:   { label: 'metric.pump',   unit: 'RPM' },
}

/** Everything an element can display: the built-in readings plus the sensors bound in Settings. */
export function useMetricOptions(): MetricOption[] {
  const sensors = useSensorSlots()
  const { t } = useLanguage()
  return [
    ...(Object.keys(BASE) as BaseMetric[]).map(id => ({ id, ...BASE[id], label: t(BASE[id].label), max: metricMax(id) })),
    ...sensors.map(s => ({ id: s.metric, label: s.label, unit: s.unit, max: s.max })),
  ]
}

export function optionFor(options: MetricOption[], id: MetricId, t: Translate): MetricOption {
  return options.find(o => o.id === id)
    ?? { id, label: isBaseMetric(id) ? metricLabel(id) : t('metrics.not_set', { name: metricLabel(id) }), unit: '', max: metricMax(id) }
}
