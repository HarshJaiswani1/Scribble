import {
  broadcastState,
  feed,
  type AppSocket,
  type GameContext,
} from './broadcast'
import type { Room, ServerPlayer } from './rooms'

/** How long a vote stays open before it's counted as failed. */
const VOTE_KICK_MS = 20_000
/**
 * Below this, "majority" degenerates to the initiator's own vote — a 2-player
 * room would let one player kick the other unilaterally.
 */
const MIN_ELIGIBLE_VOTERS = 2

function connectedExcluding(room: Room, excludeId: string): ServerPlayer[] {
  return [...room.players.values()].filter(
    (p) => p.connected && p.id !== excludeId,
  )
}

function majorityOf(eligibleCount: number): number {
  return Math.floor(eligibleCount / 2) + 1
}

export function clearVoteKick(room: Room): void {
  if (room.voteKick?.timer) clearTimeout(room.voteKick.timer)
  room.voteKick = null
}

function kickNow(ctx: GameContext, room: Room, target: ServerPlayer): void {
  const targetSocketId = target.socketId
  ctx.store.removePlayer(room, target.id)
  clearVoteKick(room)

  if (targetSocketId) {
    const targetSocket = ctx.io.sockets.sockets.get(targetSocketId) as
      | AppSocket
      | undefined
    if (targetSocket) {
      targetSocket.data.roomCode = null
      targetSocket.data.playerId = null
      targetSocket.leave(room.code)
      targetSocket.emit('room:closed', 'Voted out by the room')
    }
  }

  feed(ctx, room, 'leave', `${target.nickname} was voted out`)
  broadcastState(ctx, room)
}

export function startVoteKick(
  ctx: GameContext,
  room: Room,
  initiator: ServerPlayer,
  target: ServerPlayer,
): { ok: true } | { ok: false; error: string } {
  if (target.id === initiator.id) {
    return { ok: false, error: 'You cannot vote to kick yourself' }
  }
  if (room.voteKick) {
    return { ok: false, error: 'A vote is already in progress' }
  }

  const eligible = connectedExcluding(room, target.id)
  if (eligible.length < MIN_ELIGIBLE_VOTERS) {
    return { ok: false, error: 'Not enough players for a vote' }
  }

  const required = majorityOf(eligible.length)
  const endsAt = Date.now() + VOTE_KICK_MS

  room.voteKick = {
    targetId: target.id,
    yesVoters: new Set([initiator.id]),
    required,
    endsAt,
    timer: setTimeout(() => {
      if (!room.voteKick || room.voteKick.targetId !== target.id) return
      feed(ctx, room, 'info', `Vote to kick ${target.nickname} did not pass`)
      clearVoteKick(room)
      broadcastState(ctx, room)
    }, VOTE_KICK_MS),
  }

  feed(
    ctx,
    room,
    'info',
    `${initiator.nickname} started a vote to kick ${target.nickname} — needs ${required} votes`,
  )
  broadcastState(ctx, room)
  return { ok: true }
}

export function castVoteKick(
  ctx: GameContext,
  room: Room,
  voter: ServerPlayer,
): { ok: true } | { ok: false; error: string } {
  const vote = room.voteKick
  if (!vote) return { ok: false, error: 'No vote in progress' }
  if (voter.id === vote.targetId) {
    return { ok: false, error: 'You cannot vote in your own kick' }
  }
  if (vote.yesVoters.has(voter.id)) {
    return { ok: false, error: 'You already voted' }
  }

  vote.yesVoters.add(voter.id)

  const target = room.players.get(vote.targetId)
  if (target && vote.yesVoters.size >= vote.required) {
    kickNow(ctx, room, target)
    return { ok: true }
  }

  broadcastState(ctx, room)
  return { ok: true }
}

/**
 * Keeps an in-flight vote honest against roster churn on every join, leave,
 * disconnect, and reconnect: a voter who leaves stops counting, the required
 * majority is recomputed against whoever's still connected, and a vote whose
 * target already left is dropped outright.
 */
export function reevaluateVoteKick(ctx: GameContext, room: Room): void {
  const vote = room.voteKick
  if (!vote) return

  const target = room.players.get(vote.targetId)
  if (!target || !target.connected) {
    clearVoteKick(room)
    broadcastState(ctx, room)
    return
  }

  for (const voterId of [...vote.yesVoters]) {
    if (!room.players.get(voterId)?.connected) vote.yesVoters.delete(voterId)
  }

  const eligible = connectedExcluding(room, vote.targetId)
  if (eligible.length < MIN_ELIGIBLE_VOTERS) {
    feed(ctx, room, 'info', 'Vote to kick cancelled — not enough players')
    clearVoteKick(room)
    broadcastState(ctx, room)
    return
  }

  vote.required = majorityOf(eligible.length)

  if (vote.yesVoters.size >= vote.required) {
    kickNow(ctx, room, target)
  }
}
