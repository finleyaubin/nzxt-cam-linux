interface Props {
  on: boolean
  onChange: (v: boolean) => void
  color?: string
  size?: 'sm' | 'md'
}

export function ToggleSwitch({ on, onChange, color = 'var(--accent)', size = 'md' }: Props) {
  const W = size === 'sm' ? 38 : 46, H = size === 'sm' ? 22 : 26, B = H - 4
  return (
    <div role="switch" aria-checked={on} tabIndex={0}
      onClick={() => onChange(!on)}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!on) } }}
      style={{
        width: W, height: H, borderRadius: H / 2, background: on ? color : 'var(--selected)',
        position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background 150ms ease',
      }}>
      <div style={{
        position: 'absolute', top: 2, left: on ? W - B - 2 : 2,
        width: B, height: B, borderRadius: '50%', background: '#fff',
        transition: 'left 150ms ease', boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
      }}/>
    </div>
  )
}
