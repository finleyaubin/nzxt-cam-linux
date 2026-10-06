import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { LogoMark } from './ui/LogoMark'
import { Pulse, Snowflake, Lightbulb, Monitor, Gear, CaretLeft, CaretRight } from '@phosphor-icons/react'

type Section = 'monitoring' | 'cooling' | 'lighting' | 'lcd' | 'settings'

const IActivity  = () => <Pulse size={17} weight="regular" />
const ISnowflake = () => <Snowflake size={17} weight="regular" />
const IBulb     = () => <Lightbulb size={17} weight="regular" />
const IScreen   = () => <Monitor size={17} weight="regular" />
const IGear     = () => <Gear size={17} weight="regular" />
const IChevronLeft  = () => <CaretLeft size={13} weight="regular" />
const IChevronRight = () => <CaretRight size={13} weight="regular" />

const SIDEBAR_W = 200

const NAV: { id: Section; label: string; Icon: () => JSX.Element }[] = [
  { id: 'monitoring', label: 'Monitoring',  Icon: IActivity  },
  { id: 'cooling',    label: 'Cooling',     Icon: ISnowflake },
  { id: 'lighting',   label: 'Lighting',    Icon: IBulb      },
  { id: 'lcd',        label: 'LCD Display', Icon: IScreen    },
]

function NavItem({ id, label, Icon, isActive, accent }: {
  id: Section; label: string; Icon: () => JSX.Element; isActive: boolean; accent: string
}) {
  const { dispatch } = useApp()
  return (
    <div
      onClick={() => dispatch({ type: 'SET_SECTION', payload: id })}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 11px',
        paddingLeft: isActive ? 9 : 11,
        borderRadius: 8, marginBottom: 2, cursor: 'pointer',
        color: isActive ? '#f0f0f0' : '#484848',
        background: isActive ? `${accent}18` : 'transparent',
        borderLeft: isActive ? `2px solid ${accent}` : '2px solid transparent',
        transition: 'all 140ms', fontWeight: isActive ? 700 : 500, fontSize: 13,
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLDivElement).style.color = '#b0b0b0'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.028)' } }}
      onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLDivElement).style.color = '#7f7f7f'; (e.currentTarget as HTMLDivElement).style.background = 'transparent' } }}
    >
      <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.55 }}><Icon/></span>
      <span>{label}</span>
    </div>
  )
}

export function AppSidebar() {
  const { state, dispatch } = useApp()
  const { section, accent } = state
  const [open, setOpen] = useState(true)

  return (
    <div style={{ position: 'relative', display: 'flex', flexShrink: 0, height: '100%' }}>

      {/* Sidebar panel */}
      <div style={{
        width: open ? SIDEBAR_W : 0,
        minWidth: 0,
        overflow: 'hidden',
        background: '#0e0e0e',
        borderRight: open ? '1px solid #1c1c1c' : 'none',
        display: 'flex', flexDirection: 'column', height: '100%',
        transition: 'width 280ms cubic-bezier(0.4, 0, 0.2, 1), border-color 280ms',
      }}>
        {/* Inner wrapper — fixed width so content doesn't compress during animation */}
        <div style={{ width: SIDEBAR_W, display: 'flex', flexDirection: 'column', height: '100%' }}>

          {/* Brand */}
          <div style={{ padding: '18px 16px 20px', borderBottom: '1px solid #161616', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <LogoMark accent={accent} size={34}/>
            <div style={{ lineHeight: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#f0f0f0', letterSpacing: '-0.3px' }}>
                <span style={{ color: accent }}>NZXT</span>CAM
              </div>
              <div style={{ fontSize: 9, color: '#7f7f7f', marginTop: 4, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700 }}>Linux</div>
            </div>
          </div>

          {/* Nav */}
          <div style={{ flex: 1, padding: '0 7px' }}>
            {NAV.map(({ id, label, Icon }) => (
              <NavItem key={id} id={id} label={label} Icon={Icon} isActive={section === id} accent={accent}/>
            ))}
          </div>

          {/* Settings + collapse button at bottom */}
          <div style={{ padding: '8px 7px 10px', borderTop: '1px solid #141414' }}>
            <div
              onClick={() => dispatch({ type: 'SET_SECTION', payload: 'settings' })}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 11px',
                paddingLeft: section === 'settings' ? 9 : 11,
                borderRadius: 8, cursor: 'pointer',
                color: section === 'settings' ? '#f0f0f0' : '#484848',
                background: section === 'settings' ? `${accent}18` : 'transparent',
                borderLeft: section === 'settings' ? `2px solid ${accent}` : '2px solid transparent',
                transition: 'all 140ms', fontWeight: section === 'settings' ? 700 : 500, fontSize: 13,
                whiteSpace: 'nowrap', marginBottom: 4,
              }}
              onMouseEnter={e => { if (section !== 'settings') { (e.currentTarget as HTMLDivElement).style.color = '#b0b0b0'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.028)' } }}
              onMouseLeave={e => { if (section !== 'settings') { (e.currentTarget as HTMLDivElement).style.color = '#7f7f7f'; (e.currentTarget as HTMLDivElement).style.background = 'transparent' } }}
            >
              <span style={{ flexShrink: 0, opacity: section === 'settings' ? 1 : 0.55 }}><IGear/></span>
              <span>Settings</span>
            </div>

            {/* Collapse button */}
            <div
              onClick={() => setOpen(false)}
              title="Collapse menu"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 11px', borderRadius: 8, cursor: 'pointer',
                color: '#7f7f7f', fontSize: 11, fontWeight: 600,
                transition: 'all 140ms', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.color = '#9a9a9a'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.025)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.color = '#7f7f7f'; (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
            >
              <IChevronLeft/>
              <span>Collapse</span>
            </div>
          </div>
        </div>
      </div>

      {/* Floating re-open tab — visible only when sidebar is closed */}
      <div
        onClick={() => setOpen(true)}
        title="Expand menu"
        style={{
          position: 'absolute', left: 0, top: '50%',
          transform: `translateY(-50%) translateX(${open ? '-100%' : '0%'})`,
          opacity: open ? 0 : 1,
          pointerEvents: open ? 'none' : 'auto',
          zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 52,
          background: '#161616',
          border: '1px solid #2a2a2a',
          borderLeft: 'none',
          borderRadius: '0 7px 7px 0',
          cursor: 'pointer',
          color: '#7f7f7f',
          transition: 'opacity 240ms 60ms, transform 280ms cubic-bezier(0.4, 0, 0.2, 1), color 140ms, background 140ms',
          boxShadow: '3px 0 12px rgba(0,0,0,0.4)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.color = '#aaa'; (e.currentTarget as HTMLDivElement).style.background = '#222' }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.color = '#7f7f7f'; (e.currentTarget as HTMLDivElement).style.background = '#161616' }}
      >
        <IChevronRight/>
      </div>
    </div>
  )
}
