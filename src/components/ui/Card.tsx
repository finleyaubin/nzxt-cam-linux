interface Props {
  children: React.ReactNode
  style?: React.CSSProperties
  /** Kept for call-site compatibility; Adwaita cards have no hover effect. */
  glow?: boolean
  noBorder?: boolean
  accent?: string
}

export function Card({ children, style = {}, noBorder }: Props) {
  return (
    <div style={{
      background: 'var(--card-solid)', borderRadius: 12,
      boxShadow: noBorder ? 'none' : 'var(--shadow)',
      ...style,
    }}>{children}</div>
  )
}
