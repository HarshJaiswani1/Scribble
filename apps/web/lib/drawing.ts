import { CANVAS_BACKGROUND, type Point, type Stroke } from '@scribble/shared'

/**
 * Canvas state deliberately lives outside React. Stroke points arrive up to
 * 20×/second and a React state update per batch would re-render the whole game
 * view; the canvas subscribes imperatively and redraws instead.
 *
 * Strokes split into two layers by index:
 *   [0, committed)      — finished, painted once onto the base canvas
 *   [committed, end)    — in flight, repainted each frame on the live canvas
 *
 * `epoch` bumps only when already-painted base content becomes invalid (undo,
 * clear, sync, resize), which is what lets the common case append instead of
 * repainting thousands of points.
 */
export class DrawingBoard {
  strokes: Stroke[] = []
  committed = 0
  epoch = 0
  version = 0

  private listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(invalidateBase = false): void {
    if (invalidateBase) this.epoch += 1
    this.version += 1
    for (const listener of this.listeners) listener()
  }

  begin(stroke: Stroke): void {
    this.strokes.push(stroke)
    this.changed()
  }

  append(id: string, points: Point[]): void {
    const stroke = this.strokes[this.strokes.length - 1]
    if (!stroke || stroke.id !== id) return
    stroke.points.push(...points)
    this.changed()
  }

  end(id: string): void {
    const stroke = this.strokes[this.strokes.length - 1]
    if (!stroke || stroke.id !== id) return
    this.committed = this.strokes.length
    this.changed()
  }

  undo(id: string): void {
    const index = this.strokes.findIndex((stroke) => stroke.id === id)
    if (index === -1) return
    this.strokes.splice(index, 1)
    this.committed = Math.min(this.committed, this.strokes.length)
    this.changed(true)
  }

  clear(): void {
    this.strokes = []
    this.committed = 0
    this.changed(true)
  }

  /**
   * Replaces everything with the server's history. The last stroke stays
   * uncommitted because the drawer may still be mid-stroke on it; if it turns
   * out to be finished, the next `end` commits it harmlessly.
   */
  sync(strokes: Stroke[]): void {
    this.strokes = strokes.map((stroke) => ({ ...stroke, points: [...stroke.points] }))
    this.committed = Math.max(0, this.strokes.length - 1)
    this.changed(true)
  }
}

export const board = new DrawingBoard()

/**
 * Paints one stroke. Smoothed with quadratic segments through midpoints, which
 * turns the sparse sampled points back into something that reads as a hand.
 */
export function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
): void {
  const points = stroke.points
  if (points.length === 0) return

  // An eraser is a brush loaded with the background — the canvas is opaque, so
  // there is nothing to punch through to.
  const paint = stroke.tool === 'eraser' ? CANVAS_BACKGROUND : stroke.color
  const lineWidth = Math.max(1, stroke.width * width)

  ctx.strokeStyle = paint
  ctx.fillStyle = paint
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Non-null below: length checked above.
  if (points.length === 1) {
    const only = points[0]!
    ctx.beginPath()
    ctx.arc(only.x * width, only.y * height, lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  ctx.beginPath()
  const first = points[0]!
  ctx.moveTo(first.x * width, first.y * height)

  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i]!
    const next = points[i + 1]!
    const midX = ((current.x + next.x) / 2) * width
    const midY = ((current.y + next.y) / 2) * height
    ctx.quadraticCurveTo(current.x * width, current.y * height, midX, midY)
  }

  const last = points[points.length - 1]!
  ctx.lineTo(last.x * width, last.y * height)
  ctx.stroke()
}
