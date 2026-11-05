import { DisplayEditor } from '../display/DisplayEditor'

export function LCDScreen() {
  return (
    <div style={{ height: '100%', padding: 16, minHeight: 0 }}>
      <DisplayEditor/>
    </div>
  )
}
