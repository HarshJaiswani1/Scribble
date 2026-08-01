/**
 * Covers the reaper: seats expiring after the reconnect grace period, and empty
 * rooms being deleted. Runs against a server booted with compressed timings so
 * the whole thing takes seconds rather than minutes.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { io } from 'socket.io-client'

const PORT = process.env.TEST_PORT ?? '4124'
const URL = `http://localhost:${PORT}`
const SERVER_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.ts')

const GRACE_MS = 400
const TTL_MS = 600
const SWEEP_MS = 150

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function startServer() {
  const child = spawn('npx', ['tsx', SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT,
      RECONNECT_GRACE_MS: String(GRACE_MS),
      EMPTY_ROOM_TTL_MS: String(TTL_MS),
      SWEEP_INTERVAL_MS: String(SWEEP_MS),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (${child.exitCode})\n${stderr}`)
    }
    try {
      if ((await fetch(`${URL}/health`)).ok) return child
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  child.kill('SIGKILL')
  throw new Error(`server did not become healthy\n${stderr}`)
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], reconnection: false })
    socket.state = { name, snapshot: null, messages: [], closed: null }
    socket.on('room:state', (s) => { socket.state.snapshot = s })
    socket.on('feed:message', (m) => { socket.state.messages.push(m) })
    socket.on('room:closed', (r) => { socket.state.closed = r })
    socket.on('connect', () => resolve(socket))
    socket.on('connect_error', reject)
    setTimeout(() => reject(new Error(`${name} connect timeout`)), 5000)
  })
}

function emit(socket, event, payload) {
  return new Promise((resolve) => {
    if (payload === undefined) socket.emit(event, resolve)
    else socket.emit(event, payload, resolve)
  })
}

/** Awaits the predicate — an async one returns a Promise, which is always truthy. */
async function waitFor(predicate, label, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function roomCount() {
  return (await (await fetch(`${URL}/health`)).json()).rooms
}

const server = await startServer()
const sockets = []

try {
  console.log('\n== expired seat is released ==')
  const host = await connect('host')
  sockets.push(host)
  const created = await emit(host, 'room:create', { nickname: 'Host' })
  const code = created.data.snapshot.code

  const guest = await connect('guest')
  sockets.push(guest)
  const joined = await emit(guest, 'room:join', { code, nickname: 'Guest' })
  const guestId = joined.data.playerId
  await waitFor(() => host.state.snapshot?.players.length === 2, 'roster of 2')

  guest.disconnect()
  await waitFor(
    () => host.state.snapshot?.players.find((p) => p.id === guestId)?.connected === false,
    'guest marked offline',
  )
  check('seat survives the drop itself', host.state.snapshot.players.length === 2)

  await waitFor(() => host.state.snapshot?.players.length === 1, 'seat reaped')
  check('seat released after grace period', host.state.snapshot.players.length === 1)
  check('remaining player is the host',
    host.state.snapshot.players[0]?.id === created.data.playerId)
  check('reaping announced in the feed',
    host.state.messages.some((m) => /did not come back/i.test(m.text)),
    JSON.stringify(host.state.messages.map((m) => m.text)))

  console.log('\n== token is dead after the seat expires ==')
  const zombie = await connect('zombie')
  sockets.push(zombie)
  const reclaim = await emit(zombie, 'room:join', {
    code,
    nickname: 'Guest',
    token: joined.data.token,
  })
  check('expired token joins as a new seat', reclaim.ok, JSON.stringify(reclaim))
  check('new seat gets a new id', reclaim.data.playerId !== guestId)
  check('score starts from zero',
    reclaim.data.snapshot.players.find((p) => p.id === reclaim.data.playerId)?.score === 0)

  console.log('\n== empty room is deleted ==')
  check('room exists while occupied', (await roomCount()) >= 1)
  host.disconnect()
  zombie.disconnect()

  await waitFor(async () => (await roomCount()) === 0, 'room deleted', 8000)
  check('room deleted once empty', (await roomCount()) === 0)

  const orphan = await connect('orphan')
  sockets.push(orphan)
  const gone = await emit(orphan, 'room:join', { code, nickname: 'Orphan' })
  check('deleted room no longer joinable', !gone.ok && /no room/i.test(gone.error),
    JSON.stringify(gone))
} catch (error) {
  failed += 1
  console.log(`\n  ERROR  ${error.stack ?? error.message}`)
} finally {
  for (const s of sockets) s.disconnect()
  server.kill('SIGKILL')
  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}
