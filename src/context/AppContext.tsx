import React, { createContext, useContext, useReducer, ReactNode } from 'react'
import { DisplayConfig } from '@shared/display'
import { DeviceStatus, Temperatures } from '../lib/api'

export type Section = 'monitoring' | 'cooling' | 'lighting' | 'lcd' | 'settings'

interface AppState {
  // UI navigation
  section: Section
  accent: string
  compact: boolean
  tempUnit: '°C' | '°F'
  // Device
  deviceStatus: DeviceStatus
  temperatures: Temperatures
  isLoading: boolean
  error: string | null
  // LCD scene editor
  displayConfig: DisplayConfig | null
  /** Serialised scene last saved/applied; the editor shows unapplied changes when it differs. */
  displayApplied: string | null
  selectedElementId: string | null
}

type Action =
  | { type: 'SET_SECTION'; payload: Section }
  | { type: 'SET_ACCENT'; payload: string }
  | { type: 'SET_COMPACT'; payload: boolean }
  | { type: 'SET_TEMP_UNIT'; payload: '°C' | '°F' }
  | { type: 'SET_DEVICE_STATUS'; payload: DeviceStatus }
  | { type: 'SET_TEMPERATURES'; payload: Temperatures }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_DISPLAY_CONFIG'; payload: DisplayConfig }
  | { type: 'SET_DISPLAY_APPLIED'; payload: string | null }
  | { type: 'SELECT_ELEMENT'; payload: string | null }

const initialState: AppState = {
  section: 'monitoring',
  accent: '#9d4edd',
  compact: false,
  tempUnit: '°C',
  deviceStatus: { connected: false, productName: 'Not detected', pid: null, error: null, lcdControllable: false },
  temperatures: { cpu: 0, gpu: 0, liquid: 0, pumpRpm: 0, sensors: [] },
  isLoading: false,
  error: null,
  displayConfig: null,
  displayApplied: null,
  selectedElementId: null,
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SECTION':       return { ...state, section: action.payload }
    case 'SET_ACCENT':        return { ...state, accent: action.payload }
    case 'SET_COMPACT':       return { ...state, compact: action.payload }
    case 'SET_TEMP_UNIT':     return { ...state, tempUnit: action.payload }
    case 'SET_DEVICE_STATUS': return { ...state, deviceStatus: action.payload }
    case 'SET_TEMPERATURES':  return { ...state, temperatures: action.payload }
    case 'SET_LOADING':       return { ...state, isLoading: action.payload }
    case 'SET_ERROR':         return { ...state, error: action.payload }
    case 'SET_DISPLAY_CONFIG':return { ...state, displayConfig: action.payload }
    case 'SET_DISPLAY_APPLIED':return { ...state, displayApplied: action.payload }
    case 'SELECT_ELEMENT':    return { ...state, selectedElementId: action.payload }
    default: return state
  }
}

const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<Action> } | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
