import { useEffect, useState } from 'react'
import { Sensor, SensorSlot, api } from '../lib/api'
import { MAX_SENSORS, MetricId, defaultMaxForUnit, sensorMetric } from '@shared/display'

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
    const load = () => Promise.all([api.getSettings(), api.listSensors()]).then(([settings, catalog]) => {
      setBound((settings.sensors ?? []).flatMap((slot, i) => {
        const sensor = catalog.find(s => s.id === slot.source)
        if (!sensor) return []
        const max = sensor.unit === '%' ? 100 : slot.max ?? defaultMaxForUnit(sensor.unit)
        return [{ metric: sensorMetric(i), label: sensor.label.replace(/\s*\(.*\)$/, ''), unit: sensor.unit, max }]
      }))
    })
    load()
    window.addEventListener(SLOTS_CHANGED, load)
    return () => window.removeEventListener(SLOTS_CHANGED, load)
  }, [])

  return bound
}

const SLOTS_CHANGED = 'sensor-slots-changed'

/** Every sensor the backend can read, bound or not. */
export function useSensorCatalog(): Sensor[] {
  const [catalog, setCatalog] = useState<Sensor[]>([])
  useEffect(() => { api.listSensors().then(setCatalog).catch(() => {}) }, [])
  return catalog
}

export type BindResult = { ok: true; metric: MetricId; max: number } | { ok: false; error: string }

/** Reuse the slot already bound to `sensor`, else bind it to the first free slot (holes stay put). */
export async function bindSensor(sensor: Sensor): Promise<BindResult> {
  const max = sensor.unit === '%' ? 100 : defaultMaxForUnit(sensor.unit)
  const settings = await api.getSettings()
  const slots: SensorSlot[] = [...(settings.sensors ?? [])]
  const existing = slots.findIndex(s => s.source === sensor.id)
  if (existing >= 0) return { ok: true, metric: sensorMetric(existing), max: slots[existing].max ?? max }
  let free = slots.findIndex(s => !s.source)
  if (free < 0) free = slots.length
  if (free >= MAX_SENSORS) return { ok: false, error: `All ${MAX_SENSORS} sensor slots are in use. Remove one in Settings > Sensors first.` }
  slots[free] = { source: sensor.id, max: null }
  for (let i = 0; i < slots.length; i++) slots[i] ??= { source: null, max: null }
  const res = await api.saveSettings({ sensors: slots })
  if (!res.success) return { ok: false, error: 'Could not save the sensor binding.' }
  window.dispatchEvent(new Event(SLOTS_CHANGED))
  return { ok: true, metric: sensorMetric(free), max }
}
