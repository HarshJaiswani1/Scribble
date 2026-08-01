export type RoomPhase =
  | 'lobby'
  | 'word-select'
  | 'drawing'
  | 'round-end'
  | 'game-end'

export interface RoomSettings {
  rounds: number
  drawTimeMs: number
  maxPlayers: number
  customWords: string[]
  useOnlyCustomWords: boolean
}

/** Normalized to 0..1 against a fixed-aspect canvas, so every screen agrees. */
export interface Point {
  x: number
  y: number
}

export type DrawTool = 'brush' | 'eraser'

export interface Stroke {
  id: string
  tool: DrawTool
  color: string
  /** Fraction of canvas width, so line weight scales with the viewport. */
  width: number
  points: Point[]
}

export type MessageKind =
  | 'chat'
  | 'join'
  | 'leave'
  | 'info'
  /** Someone guessed correctly. The word itself is never in the text. */
  | 'correct'
  /** Private near-miss nudge, sent only to the guesser. */
  | 'close'
  /** Private warning, e.g. the drawer nearly said the word out loud. */
  | 'warning'
  | 'like'
  | 'dislike'

export interface FeedMessage {
  id: string
  kind: MessageKind
  playerId: string | null
  nickname: string | null
  color: string | null
  text: string
  at: number
}

export interface ScoreDelta {
  playerId: string
  delta: number
}

export interface RoundResult {
  /** Revealed only once the turn is over. */
  word: string
  deltas: ScoreDelta[]
  guessedCount: number
  drawerId: string | null
}

/**
 * The only shape of a player that ever crosses the wire. Notably absent:
 * the reconnect token, and the socket id.
 */
export interface PublicPlayer {
  id: string
  nickname: string
  color: string
  score: number
  connected: boolean
  isHost: boolean
  /** True once this player has guessed the current word. */
  hasGuessed: boolean
  isDrawing: boolean
}

/**
 * Authoritative room state. The server is the only writer; clients replace
 * their local copy wholesale whenever one arrives.
 *
 * The plaintext word is deliberately absent from this type — it reaches the
 * drawer alone, via `word:assigned`. Everyone else gets `wordPattern`.
 */
export interface RoomSnapshot {
  code: string
  phase: RoomPhase
  settings: RoomSettings
  players: PublicPlayer[]
  hostId: string | null
  /** 1-based during play, 0 in the lobby. */
  round: number
  drawerId: string | null
  /** Masked word with revealed hints, e.g. "_c_ cr___". Safe to broadcast. */
  wordPattern: string | null
  /** Server epoch ms for the current phase deadline, or null if untimed. */
  endsAt: number | null
  /** Length of the current phase, so clients can render a progress bar. */
  phaseDurationMs: number | null
  /** Populated during 'round-end' and 'game-end'. */
  roundResult: RoundResult | null
  /** Present whenever a kick vote is in flight, in any phase including the lobby. */
  voteKick: VoteKickState | null
  /** Server epoch ms at snapshot time, so clients can derive a clock offset. */
  serverTime: number
}

export interface VoteKickState {
  targetId: string
  votes: number
  required: number
  /** Server epoch ms the vote expires, for a client-side countdown. */
  endsAt: number
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type Ack<T> = (result: Result<T>) => void

export interface JoinResult {
  playerId: string
  /** Secret. Persisted client-side to reclaim this seat after a refresh. */
  token: string
  snapshot: RoomSnapshot
}
