import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { api } from '../lib/api'
import { useApp } from '../context/AppContext'

/** Pulls in layout changes made outside the window (CLI, profiles) unless the user has unapplied edits. */
export function useDisplayConfigSync() {
  const { state, dispatch } = useApp()
  const latest = useRef(state)
  latest.current = state

  useEffect(() => {
    const unlisten = listen('display-config-changed', async () => {
      const { displayConfig, displayApplied } = latest.current
      if (displayConfig && JSON.stringify(displayConfig) !== displayApplied) return
      const fresh = await api.getDisplayConfig()
      dispatch({ type: 'SET_DISPLAY_CONFIG', payload: fresh })
      dispatch({ type: 'SET_DISPLAY_APPLIED', payload: JSON.stringify(fresh) })
    })
    return () => { unlisten.then(f => f()) }
  }, [dispatch])
}
