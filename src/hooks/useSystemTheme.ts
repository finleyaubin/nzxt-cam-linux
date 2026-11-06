import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useApp } from '../context/AppContext'

interface SystemTheme {
  colors: Record<string, string>
  fontFamily: string | null
  fontSizePt: number | null
}

const POLL_INTERVAL_MS = 2000
const CSS_PX_PER_POINT = 96 / 72

const COLOR_VARS: Record<string, string> = {
  window_bg_color: '--window',
  window_fg_color: '--fg',
  headerbar_bg_color: '--headerbar',
  view_bg_color: '--view',
  card_bg_color: '--card-solid',
  popover_bg_color: '--popover',
  accent_fg_color: '--accent-fg',
  error_color: '--danger',
  warning_color: '--warning',
  success_color: '--success',
}

function isDark(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128
}

function applyTheme(theme: SystemTheme) {
  const root = document.documentElement
  for (const [name, cssVar] of Object.entries(COLOR_VARS)) {
    const value = theme.colors[name]
    if (value) root.style.setProperty(cssVar, value)
    else root.style.removeProperty(cssVar)
  }
  const windowBg = theme.colors.window_bg_color
  root.style.colorScheme = windowBg ? (isDark(windowBg) ? 'dark' : 'light') : ''
  if (theme.fontFamily) root.style.setProperty('--ui-font', `"${theme.fontFamily}"`)
  if (theme.fontSizePt) root.style.setProperty('--ui-font-size', `${Math.round(theme.fontSizePt * CSS_PX_PER_POINT * 10) / 10}px`)
}

/** Mirrors the desktop's GTK/KDE theme into CSS variables and seeds the accent from it. */
export function useSystemTheme() {
  const { dispatch } = useApp()
  const lastSignature = useRef('')
  const lastAccent = useRef<string | undefined>(undefined)

  useEffect(() => {
    const refresh = async () => {
      const theme = await invoke<SystemTheme>('get_system_theme')
      const signature = JSON.stringify(theme)
      if (signature === lastSignature.current) return
      lastSignature.current = signature
      applyTheme(theme)
      const accent = theme.colors.accent_bg_color
      if (accent && accent !== lastAccent.current) dispatch({ type: 'SET_ACCENT', payload: accent })
      lastAccent.current = accent
    }
    const poll = () => refresh().catch(e => console.error('System theme error:', e))
    poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [dispatch])
}
