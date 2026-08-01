import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { GAME_END_MS, ROUND_END_MS, WORD_SELECT_MS } from '@scribble/shared'
import {
  broadcastState,
  feed,
  type AppServer,
  type AppSocket,
  type GameContext,
} from './broadcast'
import { handleRosterChange } from './game'
import { registerHandlers } from './handlers'
import { RoomStore } from './rooms'

const PORT = Number(process.env.PORT ?? 4500)
const IS_PROD = process.env.NODE_ENV === 'production'

/** Env overrides exist mainly so the integration tests can compress timings. */
function msFromEnv(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

const SWEEP_INTERVAL_MS = msFromEnv('SWEEP_INTERVAL_MS') ?? 15_000

const ALLOWED_ORIGINS = (process.env.WEB_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

/**
 * Production requires an explicit allowlist. Development accepts any localhost
 * port, because Next silently moves to 3001+ when 3000 is already taken and a
 * hardcoded origin turns that into a confusing connection failure.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  // Non-browser clients (health checks, the integration tests) send no Origin.
  if (!origin) return true
  if (ALLOWED_ORIGINS.includes(origin)) return true
  if (IS_PROD) return false

  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

const store = new RoomStore({
  reconnectGraceMs: msFromEnv('RECONNECT_GRACE_MS'),
  emptyRoomTtlMs: msFromEnv('EMPTY_ROOM_TTL_MS'),
})

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: store.size, uptime: process.uptime() }))
    return
  }
  res.writeHead(404).end()
})

const io: AppServer = new Server(http, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST'],
  },
  // Polling is a liability behind a load balancer without sticky sessions, and
  // this server has no HTTP fallback worth keeping.
  transports: ['websocket'],
  pingInterval: 20_000,
  pingTimeout: 20_000,
  // Generous for lobby traffic; batched stroke payloads stay well under it.
  maxHttpBufferSize: 1e6,
})

const ctx: GameContext = {
  io,
  store,
  timings: {
    wordSelectMs: msFromEnv('WORD_SELECT_MS') ?? WORD_SELECT_MS,
    roundEndMs: msFromEnv('ROUND_END_MS') ?? ROUND_END_MS,
    gameEndMs: msFromEnv('GAME_END_MS') ?? GAME_END_MS,
    drawTimeMsOverride: msFromEnv('DRAW_TIME_MS'),
  },
}

io.on('connection', (socket: AppSocket) => {
  registerHandlers(ctx, socket)
})

const sweepTimer = setInterval(() => {
  const { changed, closed, dropped } = store.sweep()

  for (const { room, nickname } of dropped) {
    feed(ctx, room, 'leave', `${nickname} did not come back`)
  }
  for (const room of changed) {
    broadcastState(ctx, room)
    // A reaped seat can be the drawer's, which would otherwise stall the turn.
    handleRosterChange(ctx, room)
  }
  for (const code of closed) {
    io.to(code).emit('room:closed', 'This room was closed after being empty')
    io.socketsLeave(code)
  }
}, SWEEP_INTERVAL_MS)

http.listen(PORT, () => {
  console.log(`[scribble] realtime server on :${PORT}`)
  if (ALLOWED_ORIGINS.length > 0) {
    console.log(`[scribble] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
  } else if (IS_PROD) {
    console.warn(
      '[scribble] WEB_ORIGIN is unset in production — all browser origins will be refused',
    )
  } else {
    console.log('[scribble] allowed origins: any localhost (development)')
  }
})

function shutdown(signal: string): void {
  console.log(`[scribble] ${signal} — shutting down`)
  clearInterval(sweepTimer)
  io.close(() => {
    http.close(() => process.exit(0))
  })
  // Don't let a wedged socket hold the process open forever.
  setTimeout(() => process.exit(1), 5_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
