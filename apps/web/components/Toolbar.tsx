'use client'

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

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/8 bg-ink-900/80 p-3">
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
  )
}
