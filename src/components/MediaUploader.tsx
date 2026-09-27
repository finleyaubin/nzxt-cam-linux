import { useApp } from '../context/AppContext'
import { useIPC } from '../hooks/useIPC'
import { api } from '../lib/api'
import { UploadSimple, Thermometer } from '@phosphor-icons/react'

const IUpload = () => <UploadSimple size={28} weight="regular" />

const IThermo = () => <Thermometer size={28} weight="regular" />

export function MediaUploader() {
  const { state, dispatch } = useApp()
  const { accent } = state
  const { sendImage, sendGif, startTempMode, openFile } = useIPC()
  const controllable = state.deviceStatus.lcdControllable || !state.deviceStatus.connected

  const handleClick = async () => {
    if (state.currentMode === 'temperatures') {
      await startTempMode()
      return
    }
    const path = await openFile(state.currentMode === 'gif' ? 'gif' : 'image')
    if (!path) return
    if (state.currentMode === 'image') {
      dispatch({ type: 'SET_IMAGE_PREVIEW', payload: api.fileUrl(path) })
    } else if (state.currentMode === 'gif') {
      dispatch({ type: 'SET_GIF_PREVIEW', payload: api.fileUrl(path) })
    }
    if (state.currentMode === 'image') {
      dispatch({ type: 'SET_IMAGE_PATH', payload: path })
      await sendImage(path)
    } else if (state.currentMode === 'gif') {
      dispatch({ type: 'SET_GIF_PATH', payload: path })
      await sendGif(path)
    }
  }

  if (state.currentMode === 'temperatures') {
    return (
      <div
        onClick={controllable ? handleClick : undefined}
        style={{
          width: '100%', padding: '28px 20px', borderRadius: 12,
          border: `1px solid ${accent}33`, background: `${accent}0a`,
          cursor: controllable ? 'pointer' : 'not-allowed',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          opacity: state.isLoading ? 0.6 : 1, transition: 'all 150ms',
        }}
      >
        <span style={{ color: accent, opacity: 0.7 }}><IThermo/></span>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: accent, marginBottom: 4 }}>
            {state.isLoading ? 'Starting…' : 'Start Temperature mode'}
          </div>
          <div style={{ fontSize: 11, color: '#7f7f7f' }}>Shows CPU, GPU and liquid on the LCD</div>
        </div>
      </div>
    )
  }

  const hint = state.currentMode === 'gif' ? 'Animated GIF - max 50 MB' : 'JPG, PNG, WebP - max 50 MB'

  return (
    <div
      onClick={controllable ? handleClick : undefined}
      style={{
        width: '100%', padding: '32px 20px', borderRadius: 12,
        border: `1px dashed ${controllable ? '#2e2e2e' : '#1e1e1e'}`,
        background: '#0d0d0d',
        cursor: controllable ? 'pointer' : 'not-allowed',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        opacity: state.isLoading || !controllable ? 0.5 : 1, transition: 'all 150ms',
      }}
      onMouseEnter={e => { if (controllable && !state.isLoading) (e.currentTarget as HTMLDivElement).style.borderColor = `${accent}55` }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#2e2e2e' }}
    >
      <span style={{ color: '#7f7f7f' }}><IUpload/></span>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#c0c0c0', marginBottom: 5 }}>
          {state.isLoading ? 'Uploading…' : 'Click to select a file'}
        </div>
        <div style={{ fontSize: 11, color: '#7f7f7f' }}>{hint}</div>
        {!controllable && (
          <div style={{ fontSize: 10, color: '#ffb347', marginTop: 6 }}>Device not controllable</div>
        )}
      </div>
    </div>
  )
}
