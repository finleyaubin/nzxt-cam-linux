import { DisplayEditor } from '../display/DisplayEditor'

export function LCDScreen() {
  return (
    <div style={{ height: '100%', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>LCD Display</div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DisplayEditor/>
      </div>
    </div>
  )
}
