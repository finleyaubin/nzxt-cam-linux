interface Props {
  value: number
  max?: number
  size?: number
  stroke?: number
  color?: string
}

export function CircularGauge({ value = 0, max = 100, size = 120, stroke = 10, color = '#3584e4' }: Props) {
  const c = size / 2
  const r = c - stroke - 3

  const p2c = (deg: number) => {
    const rad = (deg - 90) * Math.PI / 180
    return { x: +(c + r * Math.cos(rad)).toFixed(3), y: +(c + r * Math.sin(rad)).toFixed(3) }
  }

  const arcD = (a1: number, a2: number) => {
    const s = p2c(a1), e = p2c(a2)
    const large = (a2 - a1) > 180 ? 1 : 0
    return `M${s.x},${s.y} A${r},${r} 0 ${large},1 ${e.x},${e.y}`
  }

  const S = 225, R = 270
  const pct = Math.min(Math.max(value / max, 0), 1)
  const endAngle = S + pct * R

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible', flexShrink: 0 }}>
      <path d={arcD(S, S + R)} fill="none" stroke="var(--border)" strokeWidth={stroke} strokeLinecap="round"/>
      {pct > 0.003 && (
        <path
          d={arcD(S, endAngle)}
          fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          style={{ transition: 'all 300ms ease' }}
        />
      )}
    </svg>
  )
}
