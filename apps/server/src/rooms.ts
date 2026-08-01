import { randomBytes, randomUUID } from 'node:crypto'
import {
  CODE_ALPHABET,
  DEFAULT_SETTINGS,
  EMPTY_ROOM_TTL_MS,
  PLAYER_COLORS,
  RECONNECT_GRACE_MS,
  ROOM_CODE_LENGTH,
  type PublicPlayer,
  type RoomPhase,
  type RoomSettings,
  type RoomSnapshot,
  type RoundResult,
  type Stroke,
} from '@scribble/shared'

export interface ServerPlayer {
  id: string
  /** Secret reconnect credential. Never enters a snapshot. */
  token: string
  nickname: string
  color: string
  score: number
  connected: boolean
  socketId: string | null
  hasGuessed: boolean
  /** Epoch ms the socket dropped, used to expire the seat. */
  disconnectedAt: number | null
  joinedAt: number
}

export interface Room {
  code: string
  hostId: string | null
  phase: RoomPhase
  settings: RoomSettings
  players: Map<string, ServerPlayer>
  /** Join order, which doubles as turn order once the game starts. */
  turnOrder: string[]

  // --- game state -----------------------------------------------------------
  round: number
  /** Players still owed a turn this round. */
  turnQueue: string[]
  drawerId: string | null
  /** Plaintext answer. Only ever sent to the drawer's own socket. */
  word: string | null
  /** Options offered to the drawer, pending their pick. */
  wordOptions: string[]
  /** Indices of `word` revealed as hints so far. */
  revealed: Set<number>
  /** Correct guessers in the order they got it, for the ranking bonus. */
  correctOrder: string[]
  /** Points earned this turn, kept separately from cumulative scores. */
  roundDeltas: Map<string, number>
  /** Words already played this game, so a game doesn't repeat itself. */
  usedWords: Set<string>
  roundResult: RoundResult | null

  // --- canvas ---------------------------------------------------------------
  strokes: Stroke[]
  /** Points accumulated this round, checked against the per-round ceiling. */
  pointsUsed: number

  // --- timing ---------------------------------------------------------------
  endsAt: number | null
  phaseDurationMs: number | null
  phaseTimer: NodeJS.Timeout | null
  hintTimers: NodeJS.Timeout[]

  createdAt: number
  /** Epoch ms the room went empty, or null while occupied. */
  emptySince: number | null
}

export interface SweepResult {
  /** Rooms whose state changed and need a re-broadcast. */
  changed: Room[]
  /** Codes of rooms that were deleted. */
  closed: string[]
  /** Seats released by the grace-period expiry, for the activity feed. */
  dropped: Array<{ room: Room; nickname: string }>
}

function randomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH)
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    // Non-null: bytes has exactly ROOM_CODE_LENGTH entries.
    const byte = bytes[i]!
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  }
  return code
}

/**
 * Masks the answer, leaving spaces and hyphens visible so guessers can see the
 * shape of the phrase. Revealed indices come from the hint timers.
 */
export function buildWordPattern(word: string, revealed: Set<number>): string {
  return [...word]
    .map((char, index) => {
      if (char === ' ' || char === '-') return char
      return revealed.has(index) ? char : '_'
    })
    .join('')
}

export interface RoomStoreOptions {
  /** How long a dropped player keeps their seat. Defaults to the shared const. */
  reconnectGraceMs?: number
  /** How long an unoccupied room survives before deletion. */
  emptyRoomTtlMs?: number
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>()
  private readonly reconnectGraceMs: number
  private readonly emptyRoomTtlMs: number

  constructor(options: RoomStoreOptions = {}) {
    this.reconnectGraceMs = options.reconnectGraceMs ?? RECONNECT_GRACE_MS
    this.emptyRoomTtlMs = options.emptyRoomTtlMs ?? EMPTY_ROOM_TTL_MS
  }

  get size(): number {
    return this.rooms.size
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase())
  }

  create(overrides?: Partial<RoomSettings>): Room {
    let code = randomCode()
    // Collisions are vanishingly rare at 32^6, but a duplicate would silently
    // merge two games, so retry rather than trust the odds.
    while (this.rooms.has(code)) code = randomCode()

    const room: Room = {
      code,
      hostId: null,
      phase: 'lobby',
      settings: { ...DEFAULT_SETTINGS, ...overrides },
      players: new Map(),
      turnOrder: [],

      round: 0,
      turnQueue: [],
      drawerId: null,
      word: null,
      wordOptions: [],
      revealed: new Set(),
      correctOrder: [],
      roundDeltas: new Map(),
      usedWords: new Set(),
      roundResult: null,

      strokes: [],
      pointsUsed: 0,

      endsAt: null,
      phaseDurationMs: null,
      phaseTimer: null,
      hintTimers: [],

      createdAt: Date.now(),
      emptySince: Date.now(),
    }
    this.rooms.set(code, room)
    return room
  }

  delete(code: string): void {
    const room = this.rooms.get(code.toUpperCase())
    if (room) clearRoomTimers(room)
    this.rooms.delete(code.toUpperCase())
  }

  connectedCount(room: Room): number {
    let n = 0
    for (const player of room.players.values()) if (player.connected) n += 1
    return n
  }

  private pickColor(room: Room): string {
    const taken = new Set<string>()
    for (const player of room.players.values()) taken.add(player.color)
    return PLAYER_COLORS.find((c) => !taken.has(c)) ?? PLAYER_COLORS[0]
  }

  /** Appends a numeric suffix if the nickname is already in the room. */
  private uniqueNickname(room: Room, desired: string): string {
    const taken = new Set<string>()
    for (const player of room.players.values()) {
      taken.add(player.nickname.toLowerCase())
    }
    if (!taken.has(desired.toLowerCase())) return desired

    for (let n = 2; n < 100; n += 1) {
      const candidate = `${desired} (${n})`
      if (!taken.has(candidate.toLowerCase())) return candidate
    }
    return `${desired} (${randomBytes(2).toString('hex')})`
  }

  addPlayer(room: Room, nickname: string, socketId: string): ServerPlayer {
    const player: ServerPlayer = {
      id: randomUUID(),
      token: randomBytes(24).toString('base64url'),
      nickname: this.uniqueNickname(room, nickname),
      color: this.pickColor(room),
      score: 0,
      connected: true,
      socketId,
      hasGuessed: false,
      disconnectedAt: null,
      joinedAt: Date.now(),
    }

    room.players.set(player.id, player)
    room.turnOrder.push(player.id)
    room.emptySince = null
    if (!room.hostId) room.hostId = player.id

    // Joining mid-game means watching until the next round, rather than being
    // slotted into a turn queue that is already part-way through.
    return player
  }

  /**
   * Looks up a seat without mutating it. Returns null when the token matches
   * nothing — a stale token from an old game is normal, not an error, so the
   * caller falls through to a fresh join.
   */
  findSeatByToken(room: Room, token: string): ServerPlayer | null {
    for (const player of room.players.values()) {
      if (player.token === token) return player
    }
    return null
  }

  /** Reattaches a returning player to their seat, preserving score. */
  reclaimSeat(room: Room, player: ServerPlayer, socketId: string): void {
    player.connected = true
    player.socketId = socketId
    player.disconnectedAt = null
    room.emptySince = null
    if (!room.hostId) room.hostId = player.id
  }

  /** Marks a seat disconnected but keeps it claimable for the grace period. */
  detach(room: Room, playerId: string): void {
    const player = room.players.get(playerId)
    if (!player) return

    player.connected = false
    player.socketId = null
    player.disconnectedAt = Date.now()

    this.markEmptyIfVacant(room)
    if (room.hostId === playerId) this.reassignHost(room)
  }

  /**
   * Starts the room's idle clock, but only on the transition into vacancy.
   * Re-stamping it on every subsequent change would let the sweep's own seat
   * releases push the deletion deadline out indefinitely.
   */
  private markEmptyIfVacant(room: Room): void {
    if (this.connectedCount(room) > 0) return
    if (room.emptySince === null) room.emptySince = Date.now()
  }

  /** Removes a seat outright — an explicit leave or a kick, not a dropout. */
  removePlayer(room: Room, playerId: string): void {
    room.players.delete(playerId)
    room.turnOrder = room.turnOrder.filter((id) => id !== playerId)
    room.turnQueue = room.turnQueue.filter((id) => id !== playerId)
    room.correctOrder = room.correctOrder.filter((id) => id !== playerId)

    this.markEmptyIfVacant(room)
    if (room.hostId === playerId) this.reassignHost(room)
  }

  /** Prefers a connected player; falls back to any remaining seat. */
  private reassignHost(room: Room): void {
    const nextConnected = room.turnOrder.find(
      (id) => room.players.get(id)?.connected,
    )
    room.hostId = nextConnected ?? room.turnOrder[0] ?? null
  }

  /**
   * Releases expired seats and deletes dead rooms. Returns what changed so the
   * caller can broadcast; the store never touches sockets itself.
   */
  sweep(now = Date.now()): SweepResult {
    const result: SweepResult = { changed: [], closed: [], dropped: [] }

    for (const room of this.rooms.values()) {
      const dropped: string[] = []

      for (const player of [...room.players.values()]) {
        if (player.connected || player.disconnectedAt === null) continue
        if (now - player.disconnectedAt < this.reconnectGraceMs) continue

        this.removePlayer(room, player.id)
        dropped.push(player.nickname)
      }

      const isEmpty = this.connectedCount(room) === 0
      if (
        isEmpty &&
        room.emptySince !== null &&
        now - room.emptySince > this.emptyRoomTtlMs
      ) {
        // Room is going away, so its drops need no broadcast.
        clearRoomTimers(room)
        this.rooms.delete(room.code)
        result.closed.push(room.code)
        continue
      }

      if (dropped.length > 0) {
        result.changed.push(room)
        for (const nickname of dropped) result.dropped.push({ room, nickname })
      }
    }

    return result
  }

  toPublicPlayer(room: Room, player: ServerPlayer): PublicPlayer {
    return {
      id: player.id,
      nickname: player.nickname,
      color: player.color,
      score: player.score,
      connected: player.connected,
      isHost: room.hostId === player.id,
      hasGuessed: player.hasGuessed,
      isDrawing: room.drawerId === player.id,
    }
  }

  snapshot(room: Room): RoomSnapshot {
    const players: PublicPlayer[] = []
    for (const id of room.turnOrder) {
      const player = room.players.get(id)
      if (player) players.push(this.toPublicPlayer(room, player))
    }

    return {
      code: room.code,
      phase: room.phase,
      settings: room.settings,
      players,
      hostId: room.hostId,
      round: room.round,
      drawerId: room.drawerId,
      wordPattern:
        room.word === null ? null : buildWordPattern(room.word, room.revealed),
      endsAt: room.endsAt,
      phaseDurationMs: room.phaseDurationMs,
      roundResult: room.roundResult,
      serverTime: Date.now(),
    }
  }
}

/** Cancels every pending phase and hint timer. Safe to call repeatedly. */
export function clearRoomTimers(room: Room): void {
  if (room.phaseTimer) {
    clearTimeout(room.phaseTimer)
    room.phaseTimer = null
  }
  for (const timer of room.hintTimers) clearTimeout(timer)
  room.hintTimers = []
}
