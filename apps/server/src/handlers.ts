import {
  MAX_POINTS_PER_ROUND,
  MAX_STROKES_PER_ROUND,
  MIN_PLAYERS,
  chatSchema,
  drawAppendSchema,
  drawBeginSchema,
  drawEndSchema,
  playerIdSchema,
  roomCreateSchema,
  roomJoinSchema,
  settingsUpdateSchema,
  wordChooseSchema,
  type Stroke,
} from '@scribble/shared'
import {
  broadcastState,
  feed,
  feedToPlayer,
  type AppSocket,
  type GameContext,
} from './broadcast'
import {
  chooseWord,
  handleChat,
  handleRosterChange,
  resetToLobby,
  startGame,
} from './game'
import type { Room } from './rooms'
import { fail, ok, parse, RateLimiter, respond } from './util'

export function registerHandlers(ctx: GameContext, socket: AppSocket): void {
  const { io, store } = ctx

  socket.data.playerId = null
  socket.data.roomCode = null

  // Joins are the only unauthenticated entry point, so they get the tightest
  // budget. Drawing is allowed to be chatty — the client flushes ~20×/sec — but
  // still bounded so a scripted client can't flood the room.
  const joinLimiter = new RateLimiter(6, 0.5)
  const settingsLimiter = new RateLimiter(10, 2)
  const drawLimiter = new RateLimiter(80, 50)
  const chatLimiter = new RateLimiter(8, 2)

  /** Resolves the room + player this socket is currently seated in. */
  function currentSeat(): { room: Room; playerId: string } | null {
    const { roomCode, playerId } = socket.data
    if (!roomCode || !playerId) return null

    const room = store.get(roomCode)
    if (!room || !room.players.has(playerId)) return null

    return { room, playerId }
  }

  /** The seat plus the resolved player record, for handlers that need both. */
  function currentPlayer() {
    const seat = currentSeat()
    if (!seat) return null
    const player = seat.room.players.get(seat.playerId)
    if (!player) return null
    return { room: seat.room, player }
  }

  /**
   * Releases this socket's seat. `leave` gives the seat up for good; `drop`
   * keeps it claimable for the reconnect grace period.
   */
  function releaseSeat(mode: 'leave' | 'drop'): void {
    const seat = currentSeat()
    socket.data.roomCode = null
    socket.data.playerId = null
    if (!seat) return

    const { room, playerId } = seat
    const nickname = room.players.get(playerId)?.nickname ?? 'A player'

    if (mode === 'leave') store.removePlayer(room, playerId)
    else store.detach(room, playerId)

    socket.leave(room.code)
    feed(
      ctx,
      room,
      'leave',
      mode === 'leave' ? `${nickname} left` : `${nickname} lost connection`,
    )
    broadcastState(ctx, room)
    // A departure can end a turn or abort the game entirely.
    handleRosterChange(ctx, room)
  }

  /** Brings a joining or reconnecting socket up to date on the canvas. */
  function sendCanvas(room: Room): void {
    if (room.phase !== 'drawing' || room.strokes.length === 0) return
    socket.emit('canvas:sync', { strokes: room.strokes })
  }

  /**
   * Re-sends the drawer their own word after a reconnect. It is absent from the
   * snapshot by design, so without this a returning drawer would be blind.
   */
  function resendPrivateState(room: Room, playerId: string): void {
    if (room.drawerId !== playerId) return

    if (room.phase === 'drawing' && room.word) {
      socket.emit('word:assigned', { word: room.word })
    } else if (room.phase === 'word-select' && room.wordOptions.length > 0) {
      socket.emit('word:options', {
        words: room.wordOptions,
        endsAt: room.endsAt ?? Date.now(),
      })
    }
  }

  socket.on('room:create', (payload, ack) => {
    if (!joinLimiter.take()) {
      respond(ack, fail('Slow down a moment and try again'))
      return
    }

    const parsed = parse(roomCreateSchema, payload)
    if (!parsed.ok) {
      respond(ack, fail(parsed.error))
      return
    }

    releaseSeat('leave')

    const room = store.create(parsed.data.settings)
    const player = store.addPlayer(room, parsed.data.nickname, socket.id)

    socket.data.roomCode = room.code
    socket.data.playerId = player.id
    void socket.join(room.code)

    respond(
      ack,
      ok({
        playerId: player.id,
        token: player.token,
        snapshot: store.snapshot(room),
      }),
    )
  })

  socket.on('room:join', (payload, ack) => {
    if (!joinLimiter.take()) {
      respond(ack, fail('Too many attempts — wait a few seconds'))
      return
    }

    const parsed = parse(roomJoinSchema, payload)
    if (!parsed.ok) {
      respond(ack, fail(parsed.error))
      return
    }

    const { code, nickname, token } = parsed.data
    const room = store.get(code)
    if (!room) {
      respond(ack, fail('No room with that code'))
      return
    }

    // A returning player reclaims their seat and score. A token matching
    // nothing is not an error — just a stale tab — so fall through to a fresh
    // join. Peek before mutating so re-joining the seat this socket already
    // holds stays a no-op instead of destroying and recreating it.
    const existing = token ? store.findSeatByToken(room, token) : null

    if (existing) {
      const alreadyMine = socket.data.playerId === existing.id

      if (!alreadyMine && socket.data.playerId) releaseSeat('leave')

      // Same token from a second tab: the newest socket wins the seat, and the
      // old one is told why it went dark rather than silently desyncing.
      const priorSocketId = existing.socketId
      if (priorSocketId && priorSocketId !== socket.id) {
        const priorSocket = io.sockets.sockets.get(priorSocketId) as
          | AppSocket
          | undefined
        if (priorSocket) {
          priorSocket.data.roomCode = null
          priorSocket.data.playerId = null
          priorSocket.leave(room.code)
          priorSocket.emit(
            'room:closed',
            'You opened this room in another tab',
          )
        }
      }

      store.reclaimSeat(room, existing, socket.id)
      socket.data.roomCode = room.code
      socket.data.playerId = existing.id
      void socket.join(room.code)

      if (!alreadyMine) {
        feed(ctx, room, 'join', `${existing.nickname} reconnected`)
      }
      broadcastState(ctx, room)
      respond(
        ack,
        ok({
          playerId: existing.id,
          token: existing.token,
          snapshot: store.snapshot(room),
        }),
      )
      sendCanvas(room)
      resendPrivateState(room, existing.id)
      return
    }

    if (room.players.size >= room.settings.maxPlayers) {
      respond(ack, fail('That room is full'))
      return
    }

    releaseSeat('leave')

    const player = store.addPlayer(room, nickname, socket.id)
    socket.data.roomCode = room.code
    socket.data.playerId = player.id
    void socket.join(room.code)

    feed(ctx, room, 'join', `${player.nickname} joined`)
    broadcastState(ctx, room)
    respond(
      ack,
      ok({
        playerId: player.id,
        token: player.token,
        snapshot: store.snapshot(room),
      }),
    )
    sendCanvas(room)
  })

  socket.on('room:leave', () => {
    releaseSeat('leave')
  })

  socket.on('room:settings', (payload, ack) => {
    if (!settingsLimiter.take()) {
      respond(ack, fail('Slow down a moment'))
      return
    }

    const seat = currentSeat()
    if (!seat) {
      respond(ack, fail('You are not in a room'))
      return
    }

    const { room, playerId } = seat
    if (room.hostId !== playerId) {
      respond(ack, fail('Only the host can change settings'))
      return
    }
    if (room.phase !== 'lobby') {
      respond(ack, fail('Settings are locked once a game starts'))
      return
    }

    const parsed = parse(settingsUpdateSchema, payload)
    if (!parsed.ok) {
      respond(ack, fail(parsed.error))
      return
    }

    const next = { ...room.settings, ...parsed.data }
    // Lowering the cap below the current roster would put the room in a state
    // it can never leave, so clamp instead of rejecting.
    next.maxPlayers = Math.max(next.maxPlayers, room.players.size)

    room.settings = next
    broadcastState(ctx, room)
    respond(ack, ok(null))
  })

  socket.on('game:start', (ack) => {
    const seat = currentSeat()
    if (!seat) {
      respond(ack, fail('You are not in a room'))
      return
    }

    const { room, playerId } = seat
    if (room.hostId !== playerId) {
      respond(ack, fail('Only the host can start the game'))
      return
    }
    if (room.phase !== 'lobby') {
      respond(ack, fail('The game is already running'))
      return
    }
    if (store.connectedCount(room) < MIN_PLAYERS) {
      respond(ack, fail(`Need at least ${MIN_PLAYERS} players to start`))
      return
    }

    respond(ack, ok(null))
    startGame(ctx, room)
  })

  socket.on('game:abort', (ack) => {
    const seat = currentSeat()
    if (!seat) {
      respond(ack, fail('You are not in a room'))
      return
    }

    const { room, playerId } = seat
    if (room.hostId !== playerId) {
      respond(ack, fail('Only the host can end the game'))
      return
    }
    if (room.phase === 'lobby') {
      respond(ack, fail('No game is running'))
      return
    }

    feed(ctx, room, 'info', 'The host ended the game')
    resetToLobby(ctx, room)
    respond(ack, ok(null))
  })

  socket.on('player:kick', (payload, ack) => {
    const seat = currentSeat()
    if (!seat) {
      respond(ack, fail('You are not in a room'))
      return
    }

    const { room, playerId } = seat
    if (room.hostId !== playerId) {
      respond(ack, fail('Only the host can remove players'))
      return
    }

    const parsed = parse(playerIdSchema, payload)
    if (!parsed.ok) {
      respond(ack, fail(parsed.error))
      return
    }

    const target = room.players.get(parsed.data.playerId)
    if (!target) {
      respond(ack, fail('That player is already gone'))
      return
    }
    if (target.id === playerId) {
      respond(ack, fail('You cannot remove yourself'))
      return
    }

    const targetSocketId = target.socketId
    store.removePlayer(room, target.id)

    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId) as
        | AppSocket
        | undefined
      if (targetSocket) {
        targetSocket.data.roomCode = null
        targetSocket.data.playerId = null
        targetSocket.leave(room.code)
        targetSocket.emit('room:closed', 'The host removed you from the room')
      }
    }

    feed(ctx, room, 'leave', `${target.nickname} was removed`)
    broadcastState(ctx, room)
    respond(ack, ok(null))
    // Removing the drawer, or the last guesser, changes the turn.
    handleRosterChange(ctx, room)
  })

  socket.on('word:choose', (payload, ack) => {
    const seat = currentSeat()
    if (!seat) {
      respond(ack, fail('You are not in a room'))
      return
    }

    const { room, playerId } = seat
    if (room.drawerId !== playerId) {
      respond(ack, fail('Only the drawer picks the word'))
      return
    }
    if (room.phase !== 'word-select') {
      respond(ack, fail('Not picking a word right now'))
      return
    }

    const parsed = parse(wordChooseSchema, payload)
    if (!parsed.ok) {
      respond(ack, fail(parsed.error))
      return
    }
    if (parsed.data.index >= room.wordOptions.length) {
      respond(ack, fail('That word is not on offer'))
      return
    }

    respond(ack, ok(null))
    chooseWord(ctx, room, parsed.data.index)
  })

  // --- drawing ---------------------------------------------------------------
  // These are unacked and validated silently: a mid-stroke rejection has no
  // useful UI, and the authoritative canvas is re-synced on reconnect anyway.

  /** Only the current drawer, mid-drawing-phase, may mutate the canvas. */
  function drawingSeat(): Room | null {
    const seat = currentSeat()
    if (!seat) return null
    const { room, playerId } = seat
    if (room.phase !== 'drawing') return null
    if (room.drawerId !== playerId) return null
    return room
  }

  socket.on('draw:begin', (payload) => {
    const room = drawingSeat()
    if (!room || !drawLimiter.take()) return

    const parsed = parse(drawBeginSchema, payload)
    if (!parsed.ok) return

    const { id, tool, color, width, points } = parsed.data
    if (room.strokes.length >= MAX_STROKES_PER_ROUND) return
    if (room.pointsUsed + points.length > MAX_POINTS_PER_ROUND) return
    // A duplicate id would make append/undo ambiguous.
    if (room.strokes.some((stroke) => stroke.id === id)) return

    const stroke: Stroke = { id, tool, color, width, points: [...points] }
    room.strokes.push(stroke)
    room.pointsUsed += points.length

    // The drawer already rendered this locally; echoing would just cost bytes.
    socket.to(room.code).emit('draw:begin', stroke)
  })

  socket.on('draw:append', (payload) => {
    const room = drawingSeat()
    if (!room || !drawLimiter.take()) return

    const parsed = parse(drawAppendSchema, payload)
    if (!parsed.ok) return

    const { id, points } = parsed.data
    // Appends only ever extend the stroke in progress, which is the last one.
    const stroke = room.strokes[room.strokes.length - 1]
    if (!stroke || stroke.id !== id) return
    if (room.pointsUsed + points.length > MAX_POINTS_PER_ROUND) return

    stroke.points.push(...points)
    room.pointsUsed += points.length

    socket.to(room.code).emit('draw:append', { id, points })
  })

  socket.on('draw:end', (payload) => {
    const room = drawingSeat()
    if (!room) return

    const parsed = parse(drawEndSchema, payload)
    if (!parsed.ok) return

    socket.to(room.code).emit('draw:end', { id: parsed.data.id })
  })

  socket.on('draw:undo', () => {
    const room = drawingSeat()
    if (!room || !drawLimiter.take()) return

    const removed = room.strokes.pop()
    if (!removed) return

    room.pointsUsed = Math.max(0, room.pointsUsed - removed.points.length)
    io.to(room.code).emit('draw:undo', { id: removed.id })
  })

  socket.on('draw:clear', () => {
    const room = drawingSeat()
    if (!room || !drawLimiter.take()) return

    room.strokes = []
    room.pointsUsed = 0
    io.to(room.code).emit('draw:clear')
  })

  // --- chat and guessing -----------------------------------------------------

  socket.on('chat:message', (payload) => {
    const seat = currentPlayer()
    if (!seat) return

    if (!chatLimiter.take()) {
      feedToPlayer(ctx, seat.player, 'warning', 'Easy on the messages')
      return
    }

    const parsed = parse(chatSchema, payload)
    if (!parsed.ok) return

    handleChat(ctx, seat.room, seat.player, parsed.data.text)
  })

  socket.on('ping:time', (ack) => {
    respond(ack, ok({ serverTime: Date.now() }))
  })

  socket.on('disconnect', () => {
    // A dropped socket keeps its seat for the grace period, unlike an explicit
    // leave — the sweep releases it if nobody comes back.
    releaseSeat('drop')
  })
}
