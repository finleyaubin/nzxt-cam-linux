/** Canvas geometry for scene elements: bounds, hit-testing and resize handles, all in 640×640 scene units. */
import { DisplayConfig, DisplayElement, LCD_SIZE } from '@shared/display'

export interface Rect { left: number; top: number; right: number; bottom: number }

export interface Handle {
  id: string
  x: number
  y: number
  cursor: string
}

type Resolve = (text: string) => string

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

let measureCtx: CanvasRenderingContext2D | null | undefined

/** Approximates the backend's text metrics (same family, bold); good enough for selection boxes. */
function textBox(text: string, size: number, font?: string | null): { w: number; h: number } {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return { w: text.length * size * 0.58, h: size * 1.2 }
  const family = font ? `"${font.replace(/"/g, '')}", ` : ''
  measureCtx.font = `700 ${size}px ${family}Inter, 'DejaVu Sans', sans-serif`
  return { w: measureCtx.measureText(text).width, h: size * 1.2 }
}

/** The scene's elements with each text's font filled in from the scene default, so geometry measures what is drawn. */
export function withSceneFont(config: DisplayConfig): DisplayElement[] {
  const { font } = config
  if (!font) return config.elements
  return config.elements.map(el => (el.type === 'text' && !el.font ? { ...el, font } : el))
}

export function elementRect(el: DisplayElement, resolve: Resolve): Rect {
  switch (el.type) {
    case 'gauge':
      return { left: el.x - el.radius, top: el.y - el.radius, right: el.x + el.radius, bottom: el.y + el.radius }
    case 'bar':
    case 'graph':
      return { left: el.x - el.width / 2, top: el.y - el.height / 2, right: el.x + el.width / 2, bottom: el.y + el.height / 2 }
    case 'text': {
      const { w, h } = textBox(resolve(el.text) || ' ', el.size, el.font)
      const left = el.align === 'left' ? el.x : el.align === 'right' ? el.x - w : el.x - w / 2
      return { left, top: el.y - h / 2, right: left + w, bottom: el.y + h / 2 }
    }
  }
}

const inside = (r: Rect, x: number, y: number, pad: number) =>
  x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad

/** Whether a click at (x, y) grabs this element. Gauges only grab their ring so they don't swallow what's inside them. */
export function hitTest(el: DisplayElement, x: number, y: number, resolve: Resolve, tolerance = 6): boolean {
  if (el.type === 'gauge') {
    const d = Math.hypot(x - el.x, y - el.y)
    return d <= el.radius + tolerance && d >= el.radius - el.thickness - tolerance
  }
  const r = elementRect(el, resolve)
  // A bar's label/value row sits above the bar itself.
  if (el.type === 'bar' && (el.showLabel || el.showValue)) r.top -= el.valueSize * 1.05
  return inside(r, x, y, tolerance)
}

const RECT_HANDLES: { id: string; hx: -1 | 0 | 1; hy: -1 | 0 | 1; cursor: string }[] = [
  { id: 'nw', hx: -1, hy: -1, cursor: 'nwse-resize' },
  { id: 'n',  hx: 0,  hy: -1, cursor: 'ns-resize'   },
  { id: 'ne', hx: 1,  hy: -1, cursor: 'nesw-resize' },
  { id: 'e',  hx: 1,  hy: 0,  cursor: 'ew-resize'   },
  { id: 'se', hx: 1,  hy: 1,  cursor: 'nwse-resize' },
  { id: 's',  hx: 0,  hy: 1,  cursor: 'ns-resize'   },
  { id: 'sw', hx: -1, hy: 1,  cursor: 'nesw-resize' },
  { id: 'w',  hx: -1, hy: 0,  cursor: 'ew-resize'   },
]

export function handlesFor(el: DisplayElement, resolve: Resolve): Handle[] {
  const r = elementRect(el, resolve)
  if (el.type === 'gauge') {
    const d = el.radius * Math.SQRT1_2
    return [{ id: 'radius', x: el.x + d, y: el.y + d, cursor: 'nwse-resize' }]
  }
  if (el.type === 'text') {
    const atLeft = el.align === 'right'
    return [{ id: atLeft ? 'size-w' : 'size-e', x: atLeft ? r.left : r.right, y: el.y, cursor: 'ew-resize' }]
  }
  const cx = (r.left + r.right) / 2
  const cy = (r.top + r.bottom) / 2
  return RECT_HANDLES.map(h => ({
    id: h.id,
    cursor: h.cursor,
    x: h.hx < 0 ? r.left : h.hx > 0 ? r.right : cx,
    y: h.hy < 0 ? r.top : h.hy > 0 ? r.bottom : cy,
  }))
}

const MIN_SIZE = { bar: { w: 40, h: 6 }, graph: { w: 90, h: 60 } }

/** Patch that moves the grabbed handle to the pointer (x, y), keeping the opposite side fixed. */
export function resizePatch(el: DisplayElement, handleId: string, px: number, py: number, resolve: Resolve): Partial<DisplayElement> {
  px = clamp(px, 0, LCD_SIZE)
  py = clamp(py, 0, LCD_SIZE)

  if (el.type === 'gauge') {
    const min = Math.max(20, el.thickness + 4)
    return { radius: Math.round(clamp(Math.hypot(px - el.x, py - el.y), min, LCD_SIZE / 2)) }
  }

  if (el.type === 'text') {
    const { w } = textBox(resolve(el.text) || ' ', el.size, el.font)
    // Distance from the anchor (the text's x) to the handle scales the font.
    const half = el.align === 'center' ? w / 2 : w
    const reach = handleId === 'size-w' ? el.x - px : px - el.x
    return { size: Math.round(clamp(el.size * (reach / half), 8, 200)) }
  }

  const h = RECT_HANDLES.find(r => r.id === handleId)
  if (!h) return {}
  const r = elementRect(el, resolve)
  const min = MIN_SIZE[el.type]
  let { left, right, top, bottom } = r
  if (h.hx < 0) left = Math.min(px, right - min.w)
  if (h.hx > 0) right = Math.max(px, left + min.w)
  if (h.hy < 0) top = Math.min(py, bottom - min.h)
  if (h.hy > 0) bottom = Math.max(py, top + min.h)
  return {
    x: Math.round((left + right) / 2),
    y: Math.round((top + bottom) / 2),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  }
}

export const CENTER = LCD_SIZE / 2
const SNAP = 5

/** Pulls a position onto the screen's centre lines when it's within a few pixels. */
export function snapToCenter(x: number, y: number): { x: number; y: number; guideX: boolean; guideY: boolean } {
  const guideX = Math.abs(x - CENTER) <= SNAP
  const guideY = Math.abs(y - CENTER) <= SNAP
  return { x: guideX ? CENTER : x, y: guideY ? CENTER : y, guideX, guideY }
}

export const clampToScreen = (v: number) => Math.round(clamp(v, 0, LCD_SIZE))

/**
 * Snaps a moving element's centre/edges to the screen centre and to other elements' centres/edges
 * (which also lines rings up concentrically). Guides are scene coordinates of the line that matched.
 */
export function snapMove(
  el: DisplayElement, nx: number, ny: number, others: DisplayElement[], resolve: Resolve,
): { x: number; y: number; guideX: number | null; guideY: number | null } {
  const r = elementRect(el, resolve)
  const offX = [r.left - el.x, (r.left + r.right) / 2 - el.x, r.right - el.x]
  const offY = [r.top - el.y, (r.top + r.bottom) / 2 - el.y, r.bottom - el.y]
  const tx = [CENTER], ty = [CENTER]
  for (const o of others) {
    const q = elementRect(o, resolve)
    tx.push(q.left, (q.left + q.right) / 2, q.right)
    ty.push(q.top, (q.top + q.bottom) / 2, q.bottom)
  }
  const best = (pos: number, offs: number[], targets: number[]) => {
    let d = 0, guide: number | null = null, min = SNAP + 0.001
    for (const off of offs) for (const t of targets) {
      const diff = t - (pos + off)
      if (Math.abs(diff) < min) { min = Math.abs(diff); d = diff; guide = t }
    }
    return { pos: Math.round(pos + d), guide }
  }
  const bx = best(nx, offX, tx)
  const by = best(ny, offY, ty)
  return { x: bx.pos, y: by.pos, guideX: bx.guide, guideY: by.guide }
}

export type CenterAxis = 'x' | 'y'

/** Moves one element, or a group as a unit, so its bounds are centred on the screen along one axis. */
export function centerPatches(els: DisplayElement[], axis: CenterAxis, resolve: Resolve): { id: string; x?: number; y?: number }[] {
  if (!els.length) return []
  const rects = els.map(el => elementRect(el, resolve))
  const [lo, hi] = axis === 'x' ? (['left', 'right'] as const) : (['top', 'bottom'] as const)
  const mid = (Math.min(...rects.map(r => r[lo])) + Math.max(...rects.map(r => r[hi]))) / 2
  const shift = CENTER - mid
  return els.map(el => (axis === 'x' ? { id: el.id, x: clampToScreen(el.x + shift) } : { id: el.id, y: clampToScreen(el.y + shift) }))
}

export type AlignMode ='left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdist' | 'vdist'

/** New positions that align (or evenly distribute) a set of elements, relative to their joint bounds. */
export function alignPatches(els: DisplayElement[], mode: AlignMode, resolve: Resolve): { id: string; x?: number; y?: number }[] {
  const items = els.map(el => ({ el, r: elementRect(el, resolve) }))
  if (items.length < 2) return []
  const L = Math.min(...items.map(i => i.r.left)), R = Math.max(...items.map(i => i.r.right))
  const T = Math.min(...items.map(i => i.r.top)), B = Math.max(...items.map(i => i.r.bottom))
  if (mode === 'hdist' || mode === 'vdist') {
    const h = mode === 'hdist'
    const lo = (i: { r: Rect }) => (h ? i.r.left : i.r.top)
    const len = (i: { r: Rect }) => (h ? i.r.right - i.r.left : i.r.bottom - i.r.top)
    const sorted = [...items].sort((a, b) => lo(a) - lo(b))
    const gap = ((h ? R - L : B - T) - sorted.reduce((s, i) => s + len(i), 0)) / (sorted.length - 1)
    let cur = h ? L : T
    return sorted.map(i => {
      const delta = cur - lo(i)
      cur += len(i) + gap
      return h ? { id: i.el.id, x: clampToScreen(i.el.x + delta) } : { id: i.el.id, y: clampToScreen(i.el.y + delta) }
    })
  }
  return items.map(({ el, r }) => {
    switch (mode) {
      case 'left': return { id: el.id, x: clampToScreen(el.x + L - r.left) }
      case 'right': return { id: el.id, x: clampToScreen(el.x + R - r.right) }
      case 'hcenter': return { id: el.id, x: clampToScreen(el.x + (L + R) / 2 - (r.left + r.right) / 2) }
      case 'top': return { id: el.id, y: clampToScreen(el.y + T - r.top) }
      case 'bottom': return { id: el.id, y: clampToScreen(el.y + B - r.bottom) }
      default: return { id: el.id, y: clampToScreen(el.y + (T + B) / 2 - (r.top + r.bottom) / 2) }
    }
  })
}
