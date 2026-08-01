'use client'

import { useState } from 'react'
import { BRUSH_WIDTHS, DRAW_COLORS } from '@scribble/shared'
import { useBrush } from '@/lib/brush'
import { board } from '@/lib/drawing'
import { getSocket } from '@/lib/socket'

export default function Toolbar() {
  const tool = useBrush((s) => s.tool)
  const color = useBrush((s) => s.color)
  const width = useBrush((s) => s.width)
  const setTool = useBrush((s) => s.setTool)
  const setColor = useBrush((s) => s.setColor)
  const setWidth = useBrush((s) => s.setWidth)
  const [showPalette, setShowPalette] = useState(false)

  const widthIndex = Math.max(0, BRUSH_WIDTHS.findIndex((w) => w === width))

  function undo() {
    // The server is authoritative on which stroke goes, and it echoes the undo
    // back to everyone including us — so no local mutation here.
    getSocket().emit('draw:undo')
  }

  function clear() {
    getSocket().emit('draw:clear')
    // Clearing is unambiguous, so take it locally too for an instant response.
    board.clear()
  }

  function cycleWidth() {
    setWidth(BRUSH_WIDTHS[(widthIndex + 1) % BRUSH_WIDTHS.length]!)
  }

  return (
    <>
      {/* Mobile: a full-width strip of equal, large tap targets — the full
          palette hides behind the current-colour cell instead of being laid
          out inline, since 20 swatches can't be large cells at phone width. */}
      <div className="relative lg:hidden">
        {showPalette && (
          <div className="absolute bottom-full left-0 z-10 mb-2 grid w-full grid-cols-8 gap-1.5 rounded-2xl border border-white/10 bg-ink-900 p-3 shadow-xl">
            {DRAW_COLORS.map((swatch) => (
              <button
                key={swatch}
                onClick={() => {
                  setColor(swatch)
                  setTool('brush')
                  setShowPalette(false)
                }}
                aria-label={`Colour ${swatch}`}
                className={`aspect-square rounded-lg border transition-transform active:scale-90 ${
                  color === swatch && tool === 'brush'
                    ? 'border-white ring-2 ring-white/60'
                    : 'border-white/20'
                }`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
        )}

        <div className="grid h-9 grid-cols-6 overflow-hidden rounded-xl border border-white/8">
          <button
            onClick={() => setShowPalette((v) => !v)}
            aria-label="Choose colour"
            aria-expanded={showPalette}
            className="grid place-items-center border-r border-white/8 bg-ink-900 active:bg-white/5"
          >
            <span
              className="size-4 rounded border border-white/20"
              style={{ backgroundColor: color }}
            />
          </button>

          <button
            onClick={cycleWidth}
            aria-label="Cycle brush size"
            className="grid place-items-center border-r border-white/8 bg-ink-900 active:bg-white/5"
          >
            <span
              className="rounded-full bg-slate-100"
              style={{
                width: `${4 + widthIndex * 3}px`,
                height: `${4 + widthIndex * 3}px`,
              }}
            />
          </button>

          <button
            onClick={() => setTool('brush')}
            aria-label="Brush"
            aria-pressed={tool === 'brush'}
            className={`grid place-items-center border-r border-white/8 text-sm ${
              tool === 'brush' ? 'bg-brand-500/25' : 'bg-ink-900 active:bg-white/5'
            }`}
          >
            ✏️
          </button>

          <button
            onClick={() => setTool('eraser')}
            aria-label="Eraser"
            aria-pressed={tool === 'eraser'}
            className={`grid place-items-center border-r border-white/8 text-sm ${
              tool === 'eraser' ? 'bg-brand-500/25' : 'bg-ink-900 active:bg-white/5'
            }`}
          >
            🧽
          </button>

          <button
            onClick={undo}
            aria-label="Undo"
            className="grid place-items-center border-r border-white/8 bg-ink-900 text-sm active:bg-white/5"
          >
            ↩️
          </button>

          <button
            onClick={clear}
            aria-label="Clear canvas"
            className="grid place-items-center bg-ink-900 text-sm active:bg-white/5"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Desktop: unchanged inline toolbar — plenty of width for every swatch
          and size to sit inline, so there's no need to hide them behind taps. */}
      <div className="hidden flex-wrap items-center gap-3 rounded-2xl border border-white/8 bg-ink-900/80 p-3 lg:flex">
        <div className="flex flex-wrap gap-1">
          {DRAW_COLORS.map((swatch) => (
            <button
              key={swatch}
              onClick={() => setColor(swatch)}
              aria-label={`Colour ${swatch}`}
              title={swatch}
              className={`size-6 rounded-md border transition-transform hover:scale-110 ${
                color === swatch && tool === 'brush'
                  ? 'border-white ring-2 ring-white/60'
                  : 'border-white/20'
              }`}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>

        <div className="h-8 w-px bg-white/10" />

        <div className="flex items-center gap-1">
          {BRUSH_WIDTHS.map((option, index) => (
            <button
              key={option}
              onClick={() => setWidth(option)}
              aria-label={`Brush size ${index + 1}`}
              className={`grid size-9 place-items-center rounded-lg transition-colors ${
                width === option ? 'bg-brand-500/25' : 'hover:bg-white/5'
              }`}
            >
              <span
                className="rounded-full bg-slate-100"
                style={{
                  // Scaled for the swatch, not the canvas — 0.05 of a real canvas
                  // would overflow this button.
                  width: `${6 + index * 5}px`,
                  height: `${6 + index * 5}px`,
                }}
              />
            </button>
          ))}
        </div>

        <div className="h-8 w-px bg-white/10" />

        <button
          onClick={() => setTool(tool === 'eraser' ? 'brush' : 'eraser')}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            tool === 'eraser'
              ? 'bg-brand-500/25 text-brand-200'
              : 'text-ink-400 hover:bg-white/5 hover:text-slate-200'
          }`}
        >
          Eraser
        </button>

        <div className="flex flex-1 justify-end gap-2">
          <button
            onClick={undo}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-400 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            Undo
          </button>
          <button
            onClick={clear}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-rose-300/80 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
          >
            Clear
          </button>
        </div>
      </div>
    </>
  )
}
