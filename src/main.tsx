import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Show window only after React has painted (no white flash), unless started with --hidden or an LCD command
invoke<boolean>('start_visible').then(visible => { if (visible) getCurrentWindow().show() })
