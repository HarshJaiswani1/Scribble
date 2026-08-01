import {
  CHARS_PER_HINT,
  DRAWER_POINTS_PER_GUESS,
  DRAWER_SWEEP_BONUS,
  GUESS_BASE_POINTS,
  GUESS_ORDER_BONUS,
  GUESS_TIME_POINTS,
  MAX_HINTS,
  MIN_PLAYERS,
  WORDS,
  WORD_OPTION_COUNT,
  type ScoreDelta,
} from '@scribble/shared'
import {
  broadcastState,
  emitToPlayer,
  feed,
  feedToPlayer,
  feedToPlayers,
  type GameContext,
} from './broadcast'
import { clearRoomTimers, type Room, type ServerPlayer } from './rooms'
import { isClose, isCorrect, mentionsWord } from './guess'

/**
 * The round engine. Every phase transition happens here, driven by server
 * timers — clients only ever receive the resulting state.
 *
 * Phase flow:
 *   lobby → word-select → drawing → round-end → (next turn | game-end) → lobby
 */

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    // Non-null: both indices are within bounds by construction.
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

/** The effective drawing time: the room's setting unless a deployment overrides it. */
function drawTimeFor(ctx: GameContext, room: Room): number {
  return ctx.timings.drawTimeMsOverride ?? room.settings.drawTimeMs
}

function connectedPlayers(room: Room): ServerPlayer[] {
  return [...room.players.values()].filter((p) => p.connected)
}

/** Turn order follows join order, skipping anyone currently offline. */
function eligibleDrawers(room: Room): string[] {
  return room.turnOrder.filter((id) => room.players.get(id)?.connected)
}

/** Everyone who could still guess this turn: connected, and not the drawer. */
function eligibleGuessers(room: Room): ServerPlayer[] {
  return connectedPlayers(room).filter((p) => p.id !== room.drawerId)
}

function wordPool(room: Room): string[] {
  const custom = room.settings.customWords
  if (room.settings.useOnlyCustomWords && custom.length > 0) return custom
  return custom.length > 0 ? [...WORDS, ...custom] : [...WORDS]
}

/** Offers unused words where possible, recycling only once the pool runs dry. */
function pickWordOptions(room: Room): string[] {
  const pool = wordPool(room)
  let fresh = pool.filter((word) => !room.usedWords.has(word))

  if (fresh.length < WORD_OPTION_COUNT) {
    room.usedWords.clear()
    fresh = pool
  }

  return shuffle(fresh).slice(0, Math.min(WORD_OPTION_COUNT, fresh.length))
}

function addDelta(room: Room, playerId: string, points: number): void {
  room.roundDeltas.set(playerId, (room.roundDeltas.get(playerId) ?? 0) + points)
}

function resetTurnState(room: Room): void {
  room.word = null
  room.wordOptions = []
  room.revealed = new Set()
  room.correctOrder = []
  room.roundDeltas = new Map()
  room.strokes = []
  room.pointsUsed = 0
  for (const player of room.players.values()) player.hasGuessed = false
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

export function startGame(ctx: GameContext, room: Room): void {
  clearRoomTimers(room)

  for (const player of room.players.values()) {
    player.score = 0
    player.hasGuessed = false
  }

  room.round = 1
  room.turnQueue = eligibleDrawers(room)
  room.usedWords = new Set()
  room.roundResult = null

  feed(ctx, room, 'info', `Game on — ${room.settings.rounds} rounds`)
  advanceTurn(ctx, room)
}

/**
 * Moves to the next drawer, rolling into the next round when the queue empties
 * and ending the game once every round is played.
 */
function advanceTurn(ctx: GameContext, room: Room): void {
  clearRoomTimers(room)

  while (room.turnQueue.length > 0) {
    // Non-null: guarded by the loop condition.
    const candidate = room.turnQueue.shift()!
    if (room.players.get(candidate)?.connected) {
      startTurn(ctx, room, candidate)
      return
    }
    // Otherwise the player left mid-round; skip their turn silently.
  }

  if (room.round >= room.settings.rounds) {
    endGame(ctx, room)
    return
  }

  room.round += 1
  room.turnQueue = eligibleDrawers(room)

  if (room.turnQueue.length === 0) {
    endGame(ctx, room)
    return
  }

  // The refilled queue holds only connected players, so this recurses once.
  advanceTurn(ctx, room)
}

function startTurn(ctx: GameContext, room: Room, drawerId: string): void {
  resetTurnState(room)

  const drawer = room.players.get(drawerId)
  if (!drawer) {
    advanceTurn(ctx, room)
    return
  }

  room.drawerId = drawerId
  room.phase = 'word-select'
  room.roundResult = null
  room.wordOptions = pickWordOptions(room)

  if (room.wordOptions.length === 0) {
    // Only reachable with a custom-words-only setting and an empty list.
    feed(ctx, room, 'info', 'No words available — check the custom word list')
    endGame(ctx, room)
    return
  }

  room.phaseDurationMs = ctx.timings.wordSelectMs
  room.endsAt = Date.now() + ctx.timings.wordSelectMs

  ctx.io.to(room.code).emit('draw:clear')
  feed(ctx, room, 'info', `${drawer.nickname} is picking a word`)
  emitToPlayer(ctx, drawer, 'word:options', {
    words: room.wordOptions,
    endsAt: room.endsAt,
  })
  broadcastState(ctx, room)

  // Indecision shouldn't stall the room: take the first option and move on.
  room.phaseTimer = setTimeout(() => {
    chooseWord(ctx, room, 0)
  }, ctx.timings.wordSelectMs)
}

export function chooseWord(ctx: GameContext, room: Room, index: number): void {
  if (room.phase !== 'word-select') return

  const word = room.wordOptions[index] ?? room.wordOptions[0]
  if (!word) return

  clearRoomTimers(room)

  room.word = word
  room.usedWords.add(word)
  room.wordOptions = []
  room.revealed = new Set()
  room.phase = 'drawing'
  const drawTimeMs = drawTimeFor(ctx, room)
  room.phaseDurationMs = drawTimeMs
  room.endsAt = Date.now() + drawTimeMs
  room.strokes = []
  room.pointsUsed = 0
  room.correctOrder = []
  room.roundDeltas = new Map()
  for (const player of room.players.values()) player.hasGuessed = false

  const drawer = room.drawerId ? room.players.get(room.drawerId) : null
  if (drawer) emitToPlayer(ctx, drawer, 'word:assigned', { word })

  ctx.io.to(room.code).emit('draw:clear')
  scheduleHints(ctx, room, word, drawTimeMs)
  broadcastState(ctx, room)

  room.phaseTimer = setTimeout(() => {
    endTurn(ctx, room, 'time')
  }, drawTimeMs)
}

/**
 * Reveals a few letters as the clock runs down. Never reveals so much that the
 * word is effectively given away — at least two letters always stay hidden.
 */
function scheduleHints(
  ctx: GameContext,
  room: Room,
  word: string,
  duration: number,
): void {
  const letterIndices = [...word]
    .map((char, index) => ({ char, index }))
    .filter(({ char }) => char !== ' ' && char !== '-')
    .map(({ index }) => index)

  const wanted = Math.min(
    MAX_HINTS,
    Math.floor(letterIndices.length / CHARS_PER_HINT),
  )
  const allowed = Math.max(0, letterIndices.length - 2)
  const hintCount = Math.min(wanted, allowed)
  if (hintCount === 0) return

  const chosen = shuffle(letterIndices).slice(0, hintCount)

  chosen.forEach((letterIndex, i) => {
    // Spread evenly through the phase: 1/(n+1), 2/(n+1), …
    const at = Math.floor((duration * (i + 1)) / (hintCount + 1))
    const timer = setTimeout(() => {
      if (room.phase !== 'drawing') return
      room.revealed.add(letterIndex)
      broadcastState(ctx, room)
    }, at)
    room.hintTimers.push(timer)
  })
}

// ---------------------------------------------------------------------------
// Guessing
// ---------------------------------------------------------------------------

/** Awards points for a correct guess and ends the turn if everyone has it. */
function registerCorrectGuess(
  ctx: GameContext,
  room: Room,
  player: ServerPlayer,
): void {
  const duration = room.phaseDurationMs ?? drawTimeFor(ctx, room)
  const remaining = Math.max(0, (room.endsAt ?? 0) - Date.now())
  const fraction = duration > 0 ? Math.min(1, remaining / duration) : 0

  const rank = room.correctOrder.length
  const bonus = GUESS_ORDER_BONUS[rank] ?? 0
  const points =
    GUESS_BASE_POINTS + Math.round(GUESS_TIME_POINTS * fraction) + bonus

  player.hasGuessed = true
  player.score += points
  room.correctOrder.push(player.id)
  addDelta(room, player.id, points)

  // The word itself never appears in this text — players still guessing must
  // learn nothing beyond the fact that someone got there.
  feed(ctx, room, 'correct', `${player.nickname} guessed the word!`, player)
  broadcastState(ctx, room)

  const guessers = eligibleGuessers(room)
  if (guessers.length > 0 && guessers.every((p) => p.hasGuessed)) {
    endTurn(ctx, room, 'all-guessed')
  }
}

/**
 * Routes a chat line: normal talk, a correct guess, a near miss, or a drawer
 * about to spoil it. Returns nothing — every outcome is a broadcast.
 */
export function handleChat(
  ctx: GameContext,
  room: Room,
  player: ServerPlayer,
  text: string,
): void {
  const inPlay = room.phase === 'drawing' && room.word !== null

  if (!inPlay) {
    feed(ctx, room, 'chat', text, player)
    return
  }

  const word = room.word!

  if (player.id === room.drawerId) {
    if (mentionsWord(text, word)) {
      feedToPlayer(ctx, player, 'warning', "Careful — that's the word!")
      return
    }
    feed(ctx, room, 'chat', text, player)
    return
  }

  // Players who already have it talk only among themselves and the drawer,
  // so a casual "it's obviously a giraffe" can't leak.
  if (player.hasGuessed) {
    const insiders = connectedPlayers(room).filter(
      (p) => p.hasGuessed || p.id === room.drawerId,
    )
    feedToPlayers(ctx, insiders, 'chat', text, player)
    return
  }

  if (isCorrect(text, word)) {
    registerCorrectGuess(ctx, room, player)
    return
  }

  // The guess is still broadcast — near misses are part of the fun — but only
  // the guesser is told how near it was.
  if (isClose(text, word)) {
    feedToPlayer(ctx, player, 'close', `"${text}" is very close!`)
  }
  feed(ctx, room, 'chat', text, player)
}

// ---------------------------------------------------------------------------
// Turn and game end
// ---------------------------------------------------------------------------

export type TurnEndReason = 'time' | 'all-guessed' | 'drawer-left'

export function endTurn(
  ctx: GameContext,
  room: Room,
  reason: TurnEndReason,
): void {
  if (room.phase !== 'drawing' && room.phase !== 'word-select') return

  clearRoomTimers(room)

  const word = room.word ?? ''
  const drawer = room.drawerId ? room.players.get(room.drawerId) : null
  const guessedCount = room.correctOrder.length

  // The drawer is paid per solver, and nothing at all if no one got it — which
  // keeps unguessable words from being a winning strategy.
  if (drawer && guessedCount > 0) {
    const guessers = eligibleGuessers(room)
    let drawerPoints = guessedCount * DRAWER_POINTS_PER_GUESS
    if (guessers.length > 0 && guessedCount >= guessers.length) {
      drawerPoints += DRAWER_SWEEP_BONUS
    }
    drawer.score += drawerPoints
    addDelta(room, drawer.id, drawerPoints)
  }

  const deltas: ScoreDelta[] = [...room.roundDeltas.entries()].map(
    ([playerId, delta]) => ({ playerId, delta }),
  )

  room.phase = 'round-end'
  room.roundResult = {
    word,
    deltas,
    guessedCount,
    drawerId: room.drawerId,
  }
  room.phaseDurationMs = ctx.timings.roundEndMs
  room.endsAt = Date.now() + ctx.timings.roundEndMs

  if (reason === 'drawer-left') {
    feed(ctx, room, 'info', `Round over — the drawer left. The word was "${word}"`)
  } else if (guessedCount === 0) {
    feed(ctx, room, 'info', `Nobody got it. The word was "${word}"`)
  } else {
    feed(ctx, room, 'info', `The word was "${word}"`)
  }

  broadcastState(ctx, room)

  room.phaseTimer = setTimeout(() => {
    advanceTurn(ctx, room)
  }, ctx.timings.roundEndMs)
}

function endGame(ctx: GameContext, room: Room): void {
  clearRoomTimers(room)

  room.phase = 'game-end'
  room.drawerId = null
  room.word = null
  room.wordOptions = []
  room.revealed = new Set()
  room.strokes = []
  room.phaseDurationMs = ctx.timings.gameEndMs
  room.endsAt = Date.now() + ctx.timings.gameEndMs

  const ranked = [...room.players.values()].sort((a, b) => b.score - a.score)
  const winner = ranked[0]
  if (winner && winner.score > 0) {
    feed(ctx, room, 'info', `${winner.nickname} wins with ${winner.score} points!`)
  } else {
    feed(ctx, room, 'info', 'Game over')
  }

  ctx.io.to(room.code).emit('draw:clear')
  broadcastState(ctx, room)

  room.phaseTimer = setTimeout(() => {
    resetToLobby(ctx, room)
  }, ctx.timings.gameEndMs)
}

export function resetToLobby(ctx: GameContext, room: Room): void {
  clearRoomTimers(room)
  resetTurnState(room)

  room.phase = 'lobby'
  room.round = 0
  room.turnQueue = []
  room.drawerId = null
  room.roundResult = null
  room.endsAt = null
  room.phaseDurationMs = null

  ctx.io.to(room.code).emit('draw:clear')
  broadcastState(ctx, room)
}

/**
 * Keeps a game honest when the roster changes: below the minimum it returns to
 * the lobby, and losing the drawer ends the turn rather than stalling on a
 * timer nobody can satisfy.
 */
export function handleRosterChange(ctx: GameContext, room: Room): void {
  if (room.phase === 'lobby') return

  if (ctx.store.connectedCount(room) < MIN_PLAYERS) {
    feed(ctx, room, 'info', 'Not enough players — back to the lobby')
    resetToLobby(ctx, room)
    return
  }

  const drawerGone =
    room.drawerId === null || !room.players.get(room.drawerId)?.connected

  if (drawerGone && (room.phase === 'drawing' || room.phase === 'word-select')) {
    endTurn(ctx, room, 'drawer-left')
    return
  }

  // A departure can also be the one that completes the round.
  if (room.phase === 'drawing') {
    const guessers = eligibleGuessers(room)
    if (guessers.length > 0 && guessers.every((p) => p.hasGuessed)) {
      endTurn(ctx, room, 'all-guessed')
    }
  }
}
