import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { MetricId, defaultMaxForUnit, sensorMetric } from '@shared/display'

export interface BoundSensor {
  metric: MetricId
  label: string
  unit: string
  /** Value drawn as a full gauge/bar. */
  max: number
}

/** Sensor slots the user has bound in Settings, with their catalog label, unit and full-scale value. */
export function useSensorSlots(): BoundSensor[] {
  const [bound, setBound] = useState<BoundSensor[]>([])

  useEffect(() => {
    Promise.all([api.getSettings(), api.listSensors()]).then(([settings, catalog]) => {
      setBound((settings.sensors ?? []).flatMap((slot, i) => {
        const sensor = catalog.find(s => s.id === slot.source)
        if (!sensor) return []
        const max = sensor.unit === '%' ? 100 : slot.max ?? defaultMaxForUnit(sensor.unit)
        return [{ metric: sensorMetric(i), label: sensor.label.replace(/\s*\(.*\)$/, ''), unit: sensor.unit, max }]
      }))
    })
  }, [])

  return bound
}
