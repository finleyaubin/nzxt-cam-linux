import { useRef, useState } from 'react'
import { DisplayConfig, DisplayElement, LCD_SIZE } from '@shared/display'
import { elementRect, handlesFor, hitTest, resizePatch, snapToCenter, clampToScreen } from './geometry'

const GUTTER = 14

type Drag =
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'resize'; id: string; handle: string }

interface Props {
  config: DisplayConfig
  previewUrl: string | null
  selectedId: string | null
  /** Rendered size of the 640×640 scene, in CSS pixels. */
  size: number
  accent: string
  resolve: (text: string) => string
  onSelect: (id: string | null) => void
  /** Called once when a drag begins, so the caller can snapshot for undo. */
  onGestureStart: () => void
  onPatch: (id: string, patch: Partial<DisplayElement>) => void
}

/**
 * The scene as the cooler will draw it (rendered by the backend), with a transparent layer on top
 * for picking, dragging and resizing elements.
 */
export function SceneCanvas({ config, previewUrl, selectedId, size, accent, resolve, onSelect, onGestureStart, onPatch }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [guides, setGuides] = useState({ x: false, y: false })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const scale = size / LCD_SIZE

  const toScene = (e: React.PointerEvent) => {
    const r = rootRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - GUTTER) / scale, y: (e.clientY - r.top - GUTTER) / scale }
  }

  const pick = (x: number, y: number) =>
    [...config.elements].reverse().find(el => hitTest(el, x, y, resolve, 5 / scale))

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const p = toScene(e)
    const handle = (e.target as HTMLElement).dataset.handle
    const selected = config.elements.find(el => el.id === selectedId)
    if (handle && selected) {
      onGestureStart()
      drag.current = { kind: 'resize', id: selected.id, handle }
    } else {
      const el = pick(p.x, p.y)
      onSelect(el?.id ?? null)
      if (!el) return
      onGestureStart()
      drag.current = { kind: 'move', id: el.id, dx: el.x - p.x, dy: el.y - p.y }
    }
    rootRef.current!.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toScene(e)
    const d = drag.current
    if (!d) {
      setHoverId(pick(p.x, p.y)?.id ?? null)
      return
    }
    const el = config.elements.find(x => x.id === d.id)
    if (!el) return
    if (d.kind === 'move') {
      const s = snapToCenter(clampToScreen(p.x + d.dx), clampToScreen(p.y + d.dy))
      setGuides({ x: s.guideX, y: s.guideY })
      onPatch(el.id, { x: s.x, y: s.y })
    } else {
      onPatch(el.id, resizePatch(el, d.handle, p.x, p.y, resolve))
    }
  }

  const endDrag = () => {
    drag.current = null
    setGuides({ x: false, y: false })
  }

  const selected = config.elements.find(el => el.id === selectedId) ?? null
  const hover = hoverId && hoverId !== selectedId ? config.elements.find(el => el.id === hoverId) ?? null : null
  const box = (el: DisplayElement) => {
    const r = elementRect(el, resolve)
    return {
      position: 'absolute' as const,
      left: r.left * scale, top: r.top * scale,
      width: (r.right - r.left) * scale, height: (r.bottom - r.top) * scale,
      borderRadius: el.type === 'gauge' ? '50%' : 4,
      pointerEvents: 'none' as const,
    }
  }

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setHoverId(null)}
      style={{
        position: 'relative', width: size + GUTTER * 2, height: size + GUTTER * 2, touchAction: 'none', userSelect: 'none',
        cursor: drag.current ? 'grabbing' : hover ? 'grab' : 'default',
      }}
    >
      <div style={{ position: 'absolute', left: GUTTER, top: GUTTER, width: size, height: size }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 10, overflow: 'hidden', background: config.background }}>
          {previewUrl
            ? <img src={previewUrl} alt="LCD preview" draggable={false} style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}/>
            : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: 12, color: '#7f7f7f' }}>Rendering…</div>}
          {/* The cooler's screen is round: dim what falls outside it. */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(circle at center, transparent calc(50% - 1px), rgba(0,0,0,0.62) 50%)',
          }}/>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)', pointerEvents: 'none' }}/>
          {guides.x && <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: accent, opacity: 0.8, pointerEvents: 'none' }}/>}
          {guides.y && <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: accent, opacity: 0.8, pointerEvents: 'none' }}/>}
        </div>

        {hover && <div style={{ ...box(hover), border: `1px dashed ${accent}88` }}/>}
        {selected && (
          <>
            <div style={{ ...box(selected), border: `1.5px solid ${accent}`, boxShadow: `0 0 0 1px #000a` }}/>
            {handlesFor(selected, resolve).map(h => (
              <div key={h.id} data-handle={h.id} style={{
                position: 'absolute', width: 11, height: 11, left: h.x * scale - 5.5, top: h.y * scale - 5.5,
                background: '#fff', border: `2px solid ${accent}`, borderRadius: 3, cursor: h.cursor, boxSizing: 'border-box',
              }}/>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
