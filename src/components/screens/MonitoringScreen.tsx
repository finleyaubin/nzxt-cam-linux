import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useApp } from '../../context/AppContext'
import { useLanguage } from '../../i18n/LangContext'
import { CircularGauge } from '../ui/CircularGauge'
import { SparkChart } from '../ui/SparkChart'
import { Card } from '../ui/Card'
import { ProgressBar } from '../ui/ProgressBar'

function gaugeColor(v: number, isTemp = false) {
  if (isTemp) return v > 80 ? '#f66151' : v > 60 ? '#f5c211' : '#3584e4'
  return v > 82 ? '#f66151' : v > 62 ? '#f5c211' : '#3584e4'
}

function Stat({ label, val }: { label: string; val: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--fg)', fontWeight: 500 }}>{val}</div>
    </div>
  )
}

function TempCard({ id, title, sub, value, max, tempUnit, hist }: {
  id: string; title: string; sub: string; value: number; max: number; tempUnit: string; hist: number[]
}) {
  const { t } = useLanguage()
  const gc = gaugeColor(value, true)
  const disp = tempUnit === '°F' ? Math.round(value * 9 / 5 + 32) : Math.round(value)
  const unit = tempUnit === '°F' ? '°F' : '°C'
  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: 'flex', gap: 18 }}>
        <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
          <CircularGauge value={value} max={max} size={130} stroke={10} color={gc}/>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 12 }}>
            <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 30, fontWeight: 700, color: 'var(--fg)', lineHeight: 1 }}>
              {disp}<span style={{ fontSize: 14, color: 'var(--fg-dim)', fontWeight: 400 }}>{unit}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 5 }}>{t('monitoring.temp')}</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', marginBottom: 2 }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginBottom: 16, fontWeight: 500 }}>{sub}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Stat label={t('monitoring.value')} val={`${disp}${unit}`}/>
            <Stat label={t('monitoring.max')} val={`${max}${unit}`}/>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <SparkChart data={hist} color={gc} height={44} uid={id}/>
      </div>
    </Card>
  )
}

function PumpCard({ rpm, hist }: { rpm: number; hist: number[] }) {
  const { t } = useLanguage()
  const rpmPct = Math.min(100, (rpm / 3000) * 100)
  const gc = '#3584e4'
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', marginBottom: 16 }}>{t('monitoring.pump_rpm')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
          <CircularGauge value={rpmPct} size={90} stroke={8} color={gc}/>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 8 }}>
            <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: 700, color: 'var(--fg)', lineHeight: 1 }}>{Math.round(rpm)}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 4 }}>RPM</div>
          </div>
        </div>
        <div>
          <Stat label={t('monitoring.speed')} val={`${Math.round(rpm)} RPM`}/>
          <Stat label={t('monitoring.source')} val={t('monitoring.source_liquid')}/>
        </div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <SparkChart data={hist} color={gc} height={34} uid="pump"/>
      </div>
    </Card>
  )
}

interface Drive { device: string; mount: string; usedBytes: number; totalBytes: number }

const STORAGE_REFRESH_MS = 30_000

function StorageCard() {
  const { t } = useLanguage()
  const [drives, setDrives] = useState<Drive[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = () => invoke<Drive[]>('list_drives').then(d => { setDrives(d); setError(null) }).catch(e => setError(String(e)))
    load()
    const timer = setInterval(load, STORAGE_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const fmt = (bytes: number) => bytes >= 1e12 ? `${(bytes / 1e12).toFixed(1)} TB` : `${Math.round(bytes / 1e9)} GB`
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', marginBottom: 18 }}>{t('monitoring.storage')}</div>
      {error && <div style={{ fontSize: 11, color: '#f66151' }}>{error}</div>}
      {drives?.length === 0 && <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>{t('monitoring.no_drives')}</div>}
      {drives?.map(({ device, mount, usedBytes, totalBytes }) => {
        const pct = usedBytes / totalBytes * 100
        const c = pct > 90 ? '#f66151' : pct > 74 ? '#f5c211' : '#3584e4'
        return (
          <div key={device} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
              <span title={device} style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, color: c, fontWeight: 600 }}>{mount}</span>
              <span style={{ fontSize: 11, color: 'var(--fg-dim)' }}>{fmt(usedBytes)} / {fmt(totalBytes)}</span>
            </div>
            <ProgressBar value={pct} max={100} color={c} height={3}/>
          </div>
        )
      })}
    </Card>
  )
}

const genHist = (base = 20, len = 52): number[] => {
  const d: number[] = []; let v = base + Math.random() * 5
  for (let i = 0; i < len; i++) { v += (Math.random() - 0.47) * 4; v = Math.max(0, Math.min(100, v)); d.push(v) }
  return d
}

export function MonitoringScreen() {
  const { state } = useApp()
  const { t } = useLanguage()
  const { temperatures, tempUnit } = state
  const [cpuH, setCpuH] = useState(() => genHist(temperatures.cpu))
  const [gpuH, setGpuH] = useState(() => genHist(temperatures.gpu))
  const [liqH, setLiqH] = useState(() => genHist(temperatures.liquid))
  const [pumpH, setPumpH] = useState(() => genHist((temperatures.pumpRpm / 3000) * 100))

  useEffect(() => {
    setCpuH(h => [...h.slice(-51), temperatures.cpu])
    setGpuH(h => [...h.slice(-51), temperatures.gpu])
    setLiqH(h => [...h.slice(-51), temperatures.liquid])
    setPumpH(h => [...h.slice(-51), Math.min(100, (temperatures.pumpRpm / 3000) * 100)])
  }, [temperatures])

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{t('nav.monitoring')}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <TempCard id="cpu" title={t('metric.cpu')} sub={t('monitoring.cpu_temperature')} value={temperatures.cpu} max={100} tempUnit={tempUnit} hist={cpuH}/>
        <TempCard id="gpu" title={t('metric.gpu')} sub={t('monitoring.gpu_temperature')} value={temperatures.gpu} max={100} tempUnit={tempUnit} hist={gpuH}/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <TempCard id="liq" title={t('metric.liquid')} sub={t('monitoring.liquid_temperature')} value={temperatures.liquid} max={60} tempUnit={tempUnit} hist={liqH}/>
        <PumpCard rpm={temperatures.pumpRpm} hist={pumpH}/>
        <StorageCard/>
      </div>

      <div style={{ padding: '10px 16px', background: 'var(--card)', borderRadius: 12, display: 'flex', gap: 24 }}>
        {[
          { label: t('metric.cpu'),    val: `${Math.round(temperatures.cpu)}°C`    },
          { label: t('metric.gpu'),    val: `${Math.round(temperatures.gpu)}°C`    },
          { label: t('metric.liquid'), val: `${Math.round(temperatures.liquid)}°C` },
          { label: t('metric.pump'),   val: `${Math.round(temperatures.pumpRpm)} RPM` },
        ].map(({ label, val }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-dim)', fontWeight: 700 }}>{label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--fg-dim)', fontWeight: 500 }}>{val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
