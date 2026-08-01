import { create } from 'zustand'
import { BRUSH_WIDTHS, DRAW_COLORS, type DrawTool } from '@scribble/shared'

/** Local tool preferences. Never leaves the client except inside a stroke. */
interface BrushState {
  tool: DrawTool
  color: string
  width: number
  setTool: (tool: DrawTool) => void
  setColor: (color: string) => void
  setWidth: (width: number) => void
}

export const useBrush = create<BrushState>((set) => ({
  tool: 'brush',
  color: DRAW_COLORS[0],
  width: BRUSH_WIDTHS[1],
  // Picking a colour implies you want to paint with it, not erase with it.
  setColor: (color) => set({ color, tool: 'brush' }),
  setTool: (tool) => set({ tool }),
  setWidth: (width) => set({ width }),
}))
