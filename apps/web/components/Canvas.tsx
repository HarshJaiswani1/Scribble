'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  CANVAS_ASPECT_H,
  CANVAS_ASPECT_W,
  CANVAS_BACKGROUND,
  MAX_POINTS_PER_BATCH,
  type Point,
} from '@scribble/shared'
import { board, paintStroke } from '@/lib/drawing'
import { useBrush } from '@/lib/brush'
import { getSocket } from '@/lib/socket'

/** How often buffered points are shipped. 20Hz feels live and batches well. */
const FLUSH_MS = 50
/** Points closer than this (in normalized units) add nothing but bytes. */
const MIN_POINT_DISTANCE = 0.002

function clamp(value: number): number {
  // The schema tolerates slight overshoot so strokes dragged off the edge land.
  return Math.max(-0.05, Math.min(1.05, value))
}

export default function Canvas({ canDraw }: { canDraw: boolean }) {
  const baseRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  /** Base-canvas bookkeeping, so the common case appends instead of repainting. */
  const paintedEpoch = useRef(-1)
  const paintedCount = useRef(0)
  const frame = useRef(0)

  // --- input state (refs: none of this should trigger a render) --------------
  const strokeId = useRef<string | null>(null)
  const pending = useRef<Point[]>([])
  const lastSent = useRef<Point | null>(null)
  const flushTimer = useRef<number | null>(null)

  const sizeCanvases = useCallback(() => {
    const wrap = wrapRef.current
    const base = baseRef.current
    const live = liveRef.current
    if (!wrap || !base || !live) return

    const rect = wrap.getBoundingClientRect()
    if (rect.width === 0) return

    // Cap DPR: a 3× buffer on a large canvas costs more than it shows.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)

    for (const canvas of [base, live]) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // Resizing discards the backing store, so the base must be fully repainted.
    paintedEpoch.current = -1
    paintedCount.current = 0
  }, [])

  const render = useCallback(() => {
    const base = baseRef.current
    const live = liveRef.current
    if (!base || !live) return

    const baseCtx = base.getContext('2d')
    const liveCtx = live.getContext('2d')
    if (!baseCtx || !liveCtx) return

    const width = base.clientWidth
    const height = base.clientHeight
    if (width === 0 || height === 0) return

    const { strokes, committed, epoch } = board

    if (paintedEpoch.current !== epoch) {
      // Something invalidated what we already painted: repaint all of it.
      baseCtx.fillStyle = CANVAS_BACKGROUND
      baseCtx.fillRect(0, 0, width, height)
      for (let i = 0; i < committed; i += 1) {
        paintStroke(baseCtx, strokes[i]!, width, height)
      }
      paintedEpoch.current = epoch
      paintedCount.current = committed
    } else if (committed > paintedCount.current) {
      // Newly finished strokes: paint just those on top of what's there.
      for (let i = paintedCount.current; i < committed; i += 1) {
        paintStroke(baseCtx, strokes[i]!, width, height)
      }
      paintedCount.current = committed
    }

    liveCtx.clearRect(0, 0, width, height)
    for (let i = committed; i < strokes.length; i += 1) {
      paintStroke(liveCtx, strokes[i]!, width, height)
    }
  }, [])

  const scheduleRender = useCallback(() => {
    if (frame.current !== 0) return
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0
      render()
    })
  }, [render])

  useEffect(() => {
    sizeCanvases()
    render()

    const wrap = wrapRef.current
    if (!wrap) return

    const observer = new ResizeObserver(() => {
      sizeCanvases()
      scheduleRender()
    })
    observer.observe(wrap)

    const unsubscribe = board.subscribe(scheduleRender)

    return () => {
      observer.disconnect()
      unsubscribe()
      if (frame.current !== 0) window.cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [render, scheduleRender, sizeCanvases])

  // --- drawing input ---------------------------------------------------------

  const flush = useCallback(() => {
    const id = strokeId.current
    if (!id || pending.current.length === 0) return

    const points = pending.current.splice(0, MAX_POINTS_PER_BATCH)
    getSocket().emit('draw:append', { id, points })
  }, [])

  const stopFlushing = useCallback(() => {
    if (flushTimer.current !== null) {
      window.clearInterval(flushTimer.current)
      flushTimer.current = null
    }
  }, [])

  const pointFrom = useCallback((event: React.PointerEvent): Point => {
    const canvas = liveRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    }
  }, [])

  const finishStroke = useCallback(() => {
    const id = strokeId.current
    if (!id) return

    flush()
    stopFlushing()
    getSocket().emit('draw:end', { id })
    board.end(id)

    strokeId.current = null
    lastSent.current = null
    pending.current = []
  }, [flush, stopFlushing])

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!canDraw || event.button !== 0) return
    // A second pointer mid-stroke (a stray finger) would otherwise interleave.
    if (strokeId.current) return

    event.currentTarget.setPointerCapture(event.pointerId)

    const { tool, color, width } = useBrush.getState()
    const point = pointFrom(event)
    const id = crypto.randomUUID()

    strokeId.current = id
    lastSent.current = point
    pending.current = []

    board.begin({ id, tool, color, width, points: [point] })
    getSocket().emit('draw:begin', { id, tool, color, width, points: [point] })

    flushTimer.current = window.setInterval(flush, FLUSH_MS)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const id = strokeId.current
    if (!canDraw || !id) return

    const point = pointFrom(event)
    const previous = lastSent.current
    if (previous) {
      const dx = point.x - previous.x
      const dy = point.y - previous.y
      if (Math.hypot(dx, dy) < MIN_POINT_DISTANCE) return
    }

    lastSent.current = point
    // Render locally first — waiting for the server round trip to see your own
    // line is the single worst thing a drawing tool can do.
    board.append(id, [point])
    pending.current.push(point)
  }

  function handlePointerUp() {
    if (!canDraw) return
    finishStroke()
  }

  // Losing the tab mid-stroke should close it out, not leave it hanging open.
  useEffect(() => {
    if (!canDraw) return

    const onWindowUp = () => finishStroke()
    window.addEventListener('pointerup', onWindowUp)
    window.addEventListener('pointercancel', onWindowUp)
    window.addEventListener('blur', onWindowUp)

    return () => {
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowUp)
      window.removeEventListener('blur', onWindowUp)
    }
  }, [canDraw, finishStroke])

  useEffect(() => stopFlushing, [stopFlushing])

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40"
      style={{ aspectRatio: `${CANVAS_ASPECT_W} / ${CANVAS_ASPECT_H}` }}
    >
      <canvas ref={baseRef} className="absolute inset-0 block" />
      <canvas
        ref={liveRef}
        className="absolute inset-0 block"
        // touch-none is what stops a drag from scrolling the page on mobile.
        style={{
          touchAction: 'none',
          cursor: canDraw ? 'crosshair' : 'default',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  )
}
