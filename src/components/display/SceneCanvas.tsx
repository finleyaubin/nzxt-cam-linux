import { useEffect, useRef, useState } from 'react'
import { DisplayConfig, DisplayElement, LCD_SIZE } from '@shared/display'
import { elementRect, handlesFor, hitTest, resizePatch, snapMove, clampToScreen, withSceneFont } from './geometry'

const GUTTER = 14

type Drag =
  | { kind: 'move'; id: string; start: { x: number; y: number }; origin: { id: string; x: number; y: number }[] }
  | { kind: 'resize'; id: string; handle: string }

interface Props {
  config: DisplayConfig
  previewUrl: string | null
  /** Every selected element; the first is the primary one shown in the inspector. */
  selectedIds: string[]
  /** Rendered size of the 640×640 scene, in CSS pixels. */
  size: number
  accent: string
  resolve: (text: string) => string
  onSelect: (id: string | null, additive?: boolean) => void
  onPatchMany: (patches: { id: string; patch: Partial<DisplayElement> }[]) => void
  /** Inline text edit committed (double-click a text element). */
  onTextEdit: (id: string, text: string) => void
  onContextMenu: (id: string, clientX: number, clientY: number) => void
  /** Something from the 'Add to screen' list was dropped at scene coordinates. */
  onDropKind: (kind: string, x: number, y: number) => void
  /** Called once when a drag begins, so the caller can snapshot for undo. */
  onGestureStart: () => void
  onPatch: (id: string, patch: Partial<DisplayElement>) => void
}

/**
 * The scene as the cooler will draw it (rendered by the backend), with a transparent layer on top
 * for picking, dragging and resizing elements.
 */
export function SceneCanvas({ config, previewUrl, selectedIds, size, accent, resolve, onSelect, onPatchMany, onTextEdit, onContextMenu, onDropKind, onGestureStart, onPatch }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const editDone = useRef(false)
  const scale = size / LCD_SIZE
  const elements = withSceneFont(config)
  const selectedId = selectedIds[0] ?? null
  useEffect(() => { if (editing && !config.elements.some(x => x.id === editing)) setEditing(null) }, [config, editing])

  const toScene = (e: { clientX: number; clientY: number }) => {
    const r = rootRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - GUTTER) / scale, y: (e.clientY - r.top - GUTTER) / scale }
  }

  const pick = (x: number, y: number) =>
    [...elements].reverse().find(el => hitTest(el, x, y, resolve, 5 / scale))

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const p = toScene(e)
    const handle = (e.target as HTMLElement).dataset.handle
    const selected = selectedIds.length === 1 ? elements.find(el => el.id === selectedId) : undefined
    if (handle && selected) {
      onGestureStart()
      drag.current = { kind: 'resize', id: selected.id, handle }
    } else {
      const el = pick(p.x, p.y)
      if (e.shiftKey) { if (el) onSelect(el.id, true); return }
      if (!el) { onSelect(null); return }
      const ids = selectedIds.includes(el.id) ? selectedIds : [el.id]
      if (ids.length === 1) onSelect(el.id)
      onGestureStart()
      drag.current = {
        kind: 'move', id: el.id, start: p,
        origin: elements.filter(x => ids.includes(x.id)).map(x => ({ id: x.id, x: x.x, y: x.y })),
      }
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
    const el = elements.find(x => x.id === d.id)
    if (!el) return
    if (d.kind === 'move') {
      const o = d.origin.find(x => x.id === d.id)!
      const moving = new Set(d.origin.map(x => x.id))
      const s = snapMove(el, clampToScreen(o.x + p.x - d.start.x), clampToScreen(o.y + p.y - d.start.y),
        elements.filter(x => !moving.has(x.id)), resolve)
      setGuides({ x: s.guideX, y: s.guideY })
      const dx = s.x - o.x, dy = s.y - o.y
      onPatchMany(d.origin.map(x => ({ id: x.id, patch: { x: clampToScreen(x.x + dx), y: clampToScreen(x.y + dy) } })))
    } else {
      onPatch(el.id, resizePatch(el, d.handle, p.x, p.y, resolve))
    }
  }

  const endDrag = () => {
    drag.current = null
    setGuides({ x: null, y: null })
  }

  const finishEdit = (commit: boolean, value: string) => {
    if (editDone.current) return
    editDone.current = true
    const id = editing
    setEditing(null)
    const el = elements.find(x => x.id === id)
    if (commit && id && el?.type === 'text' && value !== el.text) onTextEdit(id, value)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toScene(e)
    const el = pick(p.x, p.y)
    if (el?.type !== 'text') return
    editDone.current = false
    onSelect(el.id)
    setEditing(el.id)
  }

  const editEl = editing ? elements.find(x => x.id === editing) : null

  const selectedEls = elements.filter(el => selectedIds.includes(el.id))
  const selected = selectedIds.length === 1 ? selectedEls[0] ?? null : null
  const hover = hoverId && !selectedIds.includes(hoverId) ? elements.find(el => el.id === hoverId) ?? null : null
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
      onDoubleClick={onDoubleClick}
      onContextMenu={e => {
        e.preventDefault()
        const p = toScene(e)
        const el = pick(p.x, p.y)
        if (!el) return
        if (!selectedIds.includes(el.id)) onSelect(el.id)
        onContextMenu(el.id, e.clientX, e.clientY)
      }}
      onDragOver={e => { if (e.dataTransfer.types.includes('text/plain')) e.preventDefault() }}
      onDrop={e => {
        const m = /^kraken-add:(\w+)$/.exec(e.dataTransfer.getData('text/plain'))
        if (!m) return
        e.preventDefault()
        const p = toScene(e)
        onDropKind(m[1], clampToScreen(p.x), clampToScreen(p.y))
      }}
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
          {guides.x !== null && <div style={{ position: 'absolute', left: guides.x * scale, top: 0, bottom: 0, width: 1, background: accent, opacity: 0.8, pointerEvents: 'none' }}/>}
          {guides.y !== null && <div style={{ position: 'absolute', top: guides.y * scale, left: 0, right: 0, height: 1, background: accent, opacity: 0.8, pointerEvents: 'none' }}/>}
        </div>

        {hover && <div style={{ ...box(hover), border: `1px dashed ${accent}88` }}/>}
        {selectedEls.map(el => (
          <div key={el.id} style={{ ...box(el), border: `1.5px solid ${accent}`, boxShadow: `0 0 0 1px #000a` }}/>
        ))}
        {editEl?.type === 'text' && (() => {
          const r = elementRect(editEl, resolve)
          const w = Math.max((r.right - r.left) * scale + 16, 140)
          return (
            <input
              autoFocus defaultValue={editEl.text}
              onFocus={e => e.currentTarget.select()}
              onPointerDown={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
              onContextMenu={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === 'Enter') finishEdit(true, e.currentTarget.value)
                else if (e.key === 'Escape') finishEdit(false, '')
              }}
              onBlur={e => finishEdit(true, e.currentTarget.value)}
              style={{
                position: 'absolute', left: ((r.left + r.right) / 2) * scale - w / 2, top: ((r.top + r.bottom) / 2) * scale - 15,
                width: w, height: 30, boxSizing: 'border-box', textAlign: 'center', background: '#000d', color: '#fff',
                border: `1.5px solid ${accent}`, borderRadius: 4, outline: 'none', fontSize: 14, userSelect: 'text',
              }}
            />
          )
        })()}
        {selected && !editing && (
          <>
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
