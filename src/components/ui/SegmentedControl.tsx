export function SegmentedControl<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 8, background: 'var(--hover)' }}>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)} style={{
          flex: 1, border: 'none', borderRadius: 6, padding: '4px 14px', cursor: 'pointer', fontWeight: 700,
          background: value === o ? 'var(--card-solid)' : 'transparent',
          boxShadow: value === o ? '0 1px 2px rgba(0,0,0,0.25)' : 'none',
        }}>{o}</button>
      ))}
    </div>
  )
}
