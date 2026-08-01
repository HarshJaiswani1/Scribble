import { randomUUID } from 'node:crypto'
import type { DefaultEventsMap, Server, Socket } from 'socket.io'
import type {
  ClientToServerEvents,
  FeedMessage,
  MessageKind,
  ServerToClientEvents,
  SocketData,
} from '@scribble/shared'
import type { Room, RoomStore, ServerPlayer } from './rooms'

export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SocketData
>

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SocketData
>

/**
 * Phase durations, injected rather than imported so they can be tuned per
 * deployment and compressed to milliseconds in the integration tests.
 */
export interface GameTimings {
  wordSelectMs: number
  roundEndMs: number
  gameEndMs: number
  /** When set, overrides the room's own draw-time setting. */
  drawTimeMsOverride?: number
}

/** Both the engine and the socket handlers need these, and neither owns them. */
export interface GameContext {
  io: AppServer
  store: RoomStore
  timings: GameTimings
}

export function broadcastState(ctx: GameContext, room: Room): void {
  ctx.io.to(room.code).emit('room:state', ctx.store.snapshot(room))
}

function buildMessage(
  kind: MessageKind,
  text: string,
  player?: ServerPlayer,
): FeedMessage {
  return {
    id: randomUUID(),
    kind,
    playerId: player?.id ?? null,
    nickname: player?.nickname ?? null,
    color: player?.color ?? null,
    text,
    at: Date.now(),
  }
}

/** Adds a line to the room's shared feed. */
export function feed(
  ctx: GameContext,
  room: Room,
  kind: MessageKind,
  text: string,
  player?: ServerPlayer,
): void {
  ctx.io.to(room.code).emit('feed:message', buildMessage(kind, text, player))
}

/**
 * Sends a line to one player only. Used for near-miss nudges and drawer
 * warnings — anything that would leak the answer if the room could see it.
 */
export function feedToPlayer(
  ctx: GameContext,
  player: ServerPlayer,
  kind: MessageKind,
  text: string,
): void {
  if (!player.socketId) return
  ctx.io.to(player.socketId).emit('feed:message', buildMessage(kind, text))
}

/**
 * Sends a line to a chosen subset. Players who already guessed can talk freely
 * among themselves and the drawer without tipping off anyone still guessing.
 */
export function feedToPlayers(
  ctx: GameContext,
  players: ServerPlayer[],
  kind: MessageKind,
  text: string,
  author?: ServerPlayer,
): void {
  const message = buildMessage(kind, text, author)
  for (const player of players) {
    if (player.socketId) ctx.io.to(player.socketId).emit('feed:message', message)
  }
}

export function emitToPlayer<E extends keyof ServerToClientEvents>(
  ctx: GameContext,
  player: ServerPlayer,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  if (!player.socketId) return
  ctx.io.to(player.socketId).emit(event, ...args)
}
