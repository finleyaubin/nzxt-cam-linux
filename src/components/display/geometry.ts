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
    case 'image':
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

const MIN_SIZE = { bar: { w: 40, h: 6 }, graph: { w: 90, h: 60 }, image: { w: 16, h: 16 } }

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
export interface SnapHint {
  /** Gap indicator in scene units: a short bar from (x1, y1) to (x2, y2) labelled with the gap size. */
  x1: number; y1: number; x2: number; y2: number; label: string
}

interface Candidate { off: number; target: number; guide: number; hint?: SnapHint }

/** Nearest candidate within `threshold` of the dragged position `pos`. */
function nearest(pos: number, cands: Candidate[], threshold: number): { pos: number; guide: number; hint?: SnapHint } | null {
  let best: Candidate | null = null
  let min = threshold + 0.001
  for (const c of cands) {
    const d = Math.abs(c.target - (pos + c.off))
    if (d < min) { min = d; best = c }
  }
  return best ? { pos: pos + (best.target - (pos + best.off)), guide: best.guide, hint: best.hint } : null
}

/** Gap sizes (>= 4) between neighbouring rects along one axis. */
function gapsBetween(rects: Rect[], axis: 'x' | 'y'): number[] {
  const lo = (r: Rect) => (axis === 'x' ? r.left : r.top)
  const hi = (r: Rect) => (axis === 'x' ? r.right : r.bottom)
  const sorted = [...rects].sort((p, q) => lo(p) - lo(q))
  const gaps = new Set<number>()
  for (let i = 1; i < sorted.length; i++) {
    const g = Math.round(lo(sorted[i]) - hi(sorted[i - 1]))
    if (g >= 4) gaps.add(g)
  }
  return [...gaps]
}

/**
 * Snaps a dragged element's position. Alignment (edges and centres against other elements and the
 * screen centre) wins; when nothing aligns, it falls back to matching an existing gap between
 * elements. `threshold` is in scene units, so callers pass a fixed number of screen pixels / scale.
 */
export function snapMove(
  el: DisplayElement, nx: number, ny: number, others: DisplayElement[], resolve: Resolve, threshold = SNAP,
): { x: number; y: number; guideX: number | null; guideY: number | null; hints: SnapHint[] } {
  const r = elementRect(el, resolve)
  const w = r.right - r.left
  const h = r.bottom - r.top
  const rects = others.map(o => elementRect(o, resolve))
  const offX = [r.left - el.x, (r.left + r.right) / 2 - el.x, r.right - el.x]
  const offY = [r.top - el.y, (r.top + r.bottom) / 2 - el.y, r.bottom - el.y]

  const align = (offs: number[], targets: number[]): Candidate[] =>
    offs.flatMap(off => targets.map(t => ({ off, target: t, guide: t })))
  const tx = [CENTER, ...rects.flatMap(q => [q.left, (q.left + q.right) / 2, q.right])]
  const ty = [CENTER, ...rects.flatMap(q => [q.top, (q.top + q.bottom) / 2, q.bottom])]

  const hints: SnapHint[] = []

  // Equal spacing: put this element's near edge one existing gap away from a neighbour's far edge.
  const spacing = (axis: 'x' | 'y', pos: number, otherPos: number): Candidate[] => {
    const gaps = gapsBetween([...rects, r], axis)
    const [offLo, offHi] = axis === 'x' ? [offX[0], offX[2]] : [offY[0], offY[2]]
    const size = axis === 'x' ? w : h
    return rects.flatMap(q => gaps.flatMap(g => {
      const qLo = axis === 'x' ? q.left : q.top
      const qHi = axis === 'x' ? q.right : q.bottom
      // Only neighbours this element overlaps on the other axis count as neighbours.
      const crossLo = axis === 'x' ? q.top : q.left
      const crossHi = axis === 'x' ? q.bottom : q.right
      const mine = axis === 'x' ? [otherPos + offY[0], otherPos + offY[2]] : [otherPos + offX[0], otherPos + offX[2]]
      if (mine[1] < crossLo || mine[0] > crossHi) return []
      const mid = (Math.max(mine[0], crossLo) + Math.min(mine[1], crossHi)) / 2
      const bar = (a: number, b: number): SnapHint => axis === 'x'
        ? { x1: a, y1: mid, x2: b, y2: mid, label: String(g) }
        : { x1: mid, y1: a, x2: mid, y2: b, label: String(g) }
      void pos; void size
      return [
        { off: offLo, target: qHi + g, guide: qHi, hint: bar(qHi, qHi + g) },
        { off: offHi, target: qLo - g, guide: qLo, hint: bar(qLo - g, qLo) },
      ]
    }))
  }

  let x = nearest(nx, align(offX, tx), threshold)
  let y = nearest(ny, align(offY, ty), threshold)
  const px = x?.pos ?? nx
  const py = y?.pos ?? ny
  if (!x) x = nearest(nx, spacing('x', nx, py), threshold)
  if (!y) y = nearest(ny, spacing('y', ny, px), threshold)
  for (const s of [x, y]) if (s?.hint) hints.push(s.hint)

  return {
    x: Math.round(x?.pos ?? nx), y: Math.round(y?.pos ?? ny),
    guideX: x?.guide ?? null, guideY: y?.guide ?? null, hints,
  }
}

/**
 * Resize with snapping: the dragged edge snaps to other elements' edges/centres and the screen centre,
 * and widths/heights snap to the same size as another element. Gauges snap their radius to other rings
 * (same radius, touching, or one ring-gap inside). Text isn't snapped.
 */
export function snapResize(
  el: DisplayElement, handleId: string, px: number, py: number, others: DisplayElement[], resolve: Resolve, threshold = SNAP,
): { patch: Partial<DisplayElement>; guideX: number | null; guideY: number | null } {
  px = clamp(px, 0, LCD_SIZE)
  py = clamp(py, 0, LCD_SIZE)
  let guideX: number | null = null
  let guideY: number | null = null

  if (el.type === 'gauge') {
    const dist = Math.hypot(px - el.x, py - el.y)
    const rings = others.filter((o): o is Extract<DisplayElement, { type: 'gauge' }> => o.type === 'gauge')
    const radii = [LCD_SIZE / 2, ...rings.flatMap(o => [o.radius, o.radius - o.thickness, o.radius - o.thickness - 10])]
    const hit = radii.filter(rad => rad > 0).sort((a, b) => Math.abs(a - dist) - Math.abs(b - dist))[0]
    if (hit !== undefined && Math.abs(hit - dist) <= threshold && dist > 0) {
      const k = hit / dist
      px = el.x + (px - el.x) * k
      py = el.y + (py - el.y) * k
    }
    return { patch: resizePatch(el, handleId, px, py, resolve), guideX, guideY }
  }

  const handle = RECT_HANDLES.find(h => h.id === handleId)
  if (el.type === 'text' || !handle) return { patch: resizePatch(el, handleId, px, py, resolve), guideX, guideY }

  const r = elementRect(el, resolve)
  const rects = others.map(o => elementRect(o, resolve))
  const pick = (v: number, targets: number[]) => {
    let best: number | null = null
    let min = threshold + 0.001
    for (const t of targets) if (Math.abs(t - v) < min) { min = Math.abs(t - v); best = t }
    return best
  }

  if (handle.hx !== 0) {
    const aligned = pick(px, [CENTER, ...rects.flatMap(q => [q.left, (q.left + q.right) / 2, q.right])])
    if (aligned !== null) { px = aligned; guideX = aligned }
    else {
      const fixed = handle.hx > 0 ? r.left : r.right
      const same = pick(px, rects.map(q => fixed + handle.hx * (q.right - q.left)))
      if (same !== null) px = same
    }
  }
  if (handle.hy !== 0) {
    const aligned = pick(py, [CENTER, ...rects.flatMap(q => [q.top, (q.top + q.bottom) / 2, q.bottom])])
    if (aligned !== null) { py = aligned; guideY = aligned }
    else {
      const fixed = handle.hy > 0 ? r.top : r.bottom
      const same = pick(py, rects.map(q => fixed + handle.hy * (q.bottom - q.top)))
      if (same !== null) py = same
    }
  }
  return { patch: resizePatch(el, handleId, px, py, resolve), guideX, guideY }
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
