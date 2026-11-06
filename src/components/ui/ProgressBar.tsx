interface Props {
  value: number
  max?: number
  color?: string
  height?: number
}

export function ProgressBar({ value, max = 100, color = 'var(--accent)', height = 6 }: Props) {
  const pct = Math.min(100, (value / max) * 100)
  const c = pct > 90 ? 'var(--danger)' : pct > 74 ? 'var(--warning)' : color
  return (
    <div style={{ height, background: 'var(--selected)', borderRadius: height, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: height, transition: 'width 300ms ease' }}/>
    </div>
  )
}
