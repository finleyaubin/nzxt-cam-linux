import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useLanguage } from '../i18n/LangContext'

export function CloseDialog() {
  const { t } = useLanguage()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const unlisten = listen('close-requested', () => setVisible(true))
    return () => { unlisten.then(f => f()) }
  }, [])

  if (!visible) return null

  const hideWindow = async () => {
    setVisible(false)
    await invoke('hide_window')
  }

  const quitApp = async () => {
    setVisible(false)
    await invoke('quit_app')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div role="alertdialog" style={{
        background: 'var(--popover)', borderRadius: 18, padding: '24px 24px 16px', width: 340,
        display: 'flex', flexDirection: 'column', gap: 20, boxShadow: 'var(--shadow-popover)', textAlign: 'center',
      }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{t('dialog.close.title')}</div>
          <div style={{ color: 'var(--fg-dim)', lineHeight: 1.5 }}>{t('dialog.close.sub')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="adw-btn" onClick={quitApp} style={{ flex: 1 }}>{t('dialog.close.quit')}</button>
          <button className="adw-btn suggested" onClick={hideWindow} style={{ flex: 1 }}>{t('dialog.close.keep_background')}</button>
        </div>
      </div>
    </div>
  )
}
