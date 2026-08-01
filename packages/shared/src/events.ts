import { z } from 'zod'
import {
  CHAT_MAX_LENGTH,
  CUSTOM_WORD_MAX_LENGTH,
  MAX_CUSTOM_WORDS,
  MAX_DRAW_TIME_MS,
  MAX_PLAYERS,
  MAX_POINTS_PER_BATCH,
  MAX_ROUNDS,
  MIN_DRAW_TIME_MS,
  MIN_PLAYERS,
  MIN_ROUNDS,
  NICKNAME_MAX,
  ROOM_CODE_LENGTH,
  WORD_OPTION_COUNT,
} from './constants'
import type {
  Ack,
  FeedMessage,
  JoinResult,
  Point,
  RoomSnapshot,
  Stroke,
} from './types'

/**
 * Every inbound payload has a schema here, and the server validates against it
 * before touching room state. The client gets these as static types for free,
 * but that is a convenience — it is never the enforcement point.
 */

export const nicknameSchema = z
  .string()
  .trim()
  .min(1, 'Pick a nickname')
  .max(NICKNAME_MAX, `Max ${NICKNAME_MAX} characters`)

export const roomCodeSchema = z
  .string()
  .trim()
  .length(ROOM_CODE_LENGTH, `Room codes are ${ROOM_CODE_LENGTH} characters`)
  .regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only')
  .transform((code) => code.toUpperCase())

export const roomSettingsSchema = z.object({
  rounds: z.number().int().min(MIN_ROUNDS).max(MAX_ROUNDS),
  drawTimeMs: z.number().int().min(MIN_DRAW_TIME_MS).max(MAX_DRAW_TIME_MS),
  maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS),
  customWords: z
    .array(z.string().trim().min(1).max(CUSTOM_WORD_MAX_LENGTH))
    .max(MAX_CUSTOM_WORDS),
  useOnlyCustomWords: z.boolean(),
})

export const roomCreateSchema = z.object({
  nickname: nicknameSchema,
  settings: roomSettingsSchema.partial().optional(),
})

export const roomJoinSchema = z.object({
  code: roomCodeSchema,
  nickname: nicknameSchema,
  /** Present on a refresh/reconnect; matches an existing seat. */
  token: z.string().min(1).max(128).optional(),
})

export const settingsUpdateSchema = roomSettingsSchema.partial()

export const playerIdSchema = z.object({
  playerId: z.string().min(1).max(64),
})

export const wordChooseSchema = z.object({
  index: z.number().int().min(0).max(WORD_OPTION_COUNT - 1),
})

/** Slight overshoot is allowed so a stroke dragged off-canvas still lands. */
export const pointSchema = z.object({
  x: z.number().min(-0.05).max(1.05),
  y: z.number().min(-0.05).max(1.05),
})

const strokeIdSchema = z.string().min(1).max(64)
const pointBatchSchema = z.array(pointSchema).min(1).max(MAX_POINTS_PER_BATCH)

export const drawBeginSchema = z.object({
  id: strokeIdSchema,
  tool: z.enum(['brush', 'eraser']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex color'),
  width: z.number().min(0.001).max(0.2),
  points: pointBatchSchema,
})

export const drawAppendSchema = z.object({
  id: strokeIdSchema,
  points: pointBatchSchema,
})

export const drawEndSchema = z.object({ id: strokeIdSchema })

export const chatSchema = z.object({
  text: z.string().trim().min(1).max(CHAT_MAX_LENGTH),
})

export const drawReactSchema = z.object({
  reaction: z.enum(['like', 'dislike']),
})

export type RoomCreateInput = z.input<typeof roomCreateSchema>
export type RoomJoinInput = z.input<typeof roomJoinSchema>
export type SettingsUpdateInput = z.input<typeof settingsUpdateSchema>
export type PlayerIdInput = z.input<typeof playerIdSchema>
export type WordChooseInput = z.input<typeof wordChooseSchema>
export type DrawBeginInput = z.input<typeof drawBeginSchema>
export type DrawAppendInput = z.input<typeof drawAppendSchema>
export type DrawEndInput = z.input<typeof drawEndSchema>
export type ChatInput = z.input<typeof chatSchema>
export type DrawReactInput = z.input<typeof drawReactSchema>

export interface ClientToServerEvents {
  'room:create': (payload: RoomCreateInput, ack: Ack<JoinResult>) => void
  'room:join': (payload: RoomJoinInput, ack: Ack<JoinResult>) => void
  'room:leave': () => void
  'room:settings': (payload: SettingsUpdateInput, ack: Ack<null>) => void
  'game:start': (ack: Ack<null>) => void
  /** Host bails out of a running game, returning everyone to the lobby. */
  'game:abort': (ack: Ack<null>) => void
  'player:kick': (payload: PlayerIdInput, ack: Ack<null>) => void
  /** Any player can start or join a majority vote to remove another player. */
  'player:vote-kick-start': (payload: PlayerIdInput, ack: Ack<null>) => void
  'player:vote-kick-cast': (ack: Ack<null>) => void
  /** Round-trip used once on connect to measure clock offset. */
  'ping:time': (ack: Ack<{ serverTime: number }>) => void

  'word:choose': (payload: WordChooseInput, ack: Ack<null>) => void

  // Drawing is fire-and-forget: acking every batch would double the traffic
  // for no benefit, since the server is authoritative and re-broadcasts.
  'draw:begin': (payload: DrawBeginInput) => void
  'draw:append': (payload: DrawAppendInput) => void
  'draw:end': (payload: DrawEndInput) => void
  'draw:undo': () => void
  'draw:clear': () => void

  'chat:message': (payload: ChatInput) => void

  /** Non-drawers only, once per turn — the drawer cannot react to their own work. */
  'draw:react': (payload: DrawReactInput, ack: Ack<null>) => void
}

export interface ServerToClientEvents {
  /** Full authoritative state. Clients replace, never merge. */
  'room:state': (snapshot: RoomSnapshot) => void
  'room:closed': (reason: string) => void
  'feed:message': (message: FeedMessage) => void

  /** Drawer only — the words on offer this turn. */
  'word:options': (payload: { words: string[]; endsAt: number }) => void
  /** Drawer only — the plaintext answer, once chosen. */
  'word:assigned': (payload: { word: string }) => void

  'draw:begin': (stroke: Stroke) => void
  'draw:append': (payload: { id: string; points: Point[] }) => void
  'draw:end': (payload: { id: string }) => void
  'draw:undo': (payload: { id: string }) => void
  'draw:clear': () => void
  /** Full stroke history, sent to a late joiner or on reconnect. */
  'canvas:sync': (payload: { strokes: Stroke[] }) => void
}

export interface SocketData {
  playerId: string | null
  roomCode: string | null
}
