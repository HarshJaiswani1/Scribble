import type { RoomSettings } from './types'

/** Ambiguous glyphs (I/1, O/0) are excluded so codes survive being read aloud. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6

export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 12
export const NICKNAME_MAX = 16

export const MIN_ROUNDS = 1
export const MAX_ROUNDS = 10
export const MIN_DRAW_TIME_MS = 30_000
export const MAX_DRAW_TIME_MS = 180_000

export const MAX_CUSTOM_WORDS = 500
export const CUSTOM_WORD_MAX_LENGTH = 32

/** How long a disconnected player keeps their seat and score. */
export const RECONNECT_GRACE_MS = 30_000
/** Empty rooms are swept this long after the last player leaves. */
export const EMPTY_ROOM_TTL_MS = 60_000

export const DEFAULT_SETTINGS: RoomSettings = {
  rounds: 3,
  drawTimeMs: 80_000,
  maxPlayers: 8,
  customWords: [],
  useOnlyCustomWords: false,
}

export const PLAYER_COLORS = [
  '#f87171',
  '#fb923c',
  '#fbbf24',
  '#a3e635',
  '#34d399',
  '#22d3ee',
  '#60a5fa',
  '#a78bfa',
  '#f472b6',
  '#fda4af',
  '#4ade80',
  '#94a3b8',
] as const

// ---------------------------------------------------------------------------
// Round timings
// ---------------------------------------------------------------------------

/** How long the drawer has to pick from the offered words. */
export const WORD_SELECT_MS = 15_000
export const WORD_OPTION_COUNT = 3
/** Scoreboard pause between turns. */
export const ROUND_END_MS = 6_000
/** Final scoreboard before the room drops back to the lobby. */
export const GAME_END_MS = 20_000

/** Hints revealed over the drawing phase, scaled by word length. */
export const MAX_HINTS = 3
export const CHARS_PER_HINT = 4

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Awarded to any correct guesser, regardless of speed. */
export const GUESS_BASE_POINTS = 50
/** Additional points scaled linearly by time remaining. */
export const GUESS_TIME_POINTS = 300
/** Bonus for the 1st, 2nd, 3rd correct guesser. */
export const GUESS_ORDER_BONUS = [50, 30, 15] as const
/** The drawer earns per player who got it — so a clear drawing pays. */
export const DRAWER_POINTS_PER_GUESS = 30
/** Extra for the drawer when every guesser got there. */
export const DRAWER_SWEEP_BONUS = 50

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

/** Fixed so normalized coordinates map identically on every device. */
export const CANVAS_ASPECT_W = 4
export const CANVAS_ASPECT_H = 3
export const CANVAS_BACKGROUND = '#ffffff'

/** Stroke widths as a fraction of canvas width. */
export const BRUSH_WIDTHS = [0.006, 0.013, 0.026, 0.05] as const

export const DRAW_COLORS = [
  '#000000', '#6b7280', '#ffffff', '#ef4444', '#f97316',
  '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899',
  '#a16207', '#78350f', '#155e75', '#1e3a8a', '#4c1d95',
] as const

/** Points per network batch. The client flushes on a timer well under this. */
export const MAX_POINTS_PER_BATCH = 96
/** Per-round ceilings that bound server memory for a runaway client. */
export const MAX_STROKES_PER_ROUND = 800
export const MAX_POINTS_PER_ROUND = 60_000

export const CHAT_MAX_LENGTH = 160
