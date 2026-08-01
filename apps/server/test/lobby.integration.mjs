/**
 * End-to-end check of the lobby protocol against a real server process.
 * Run with `npm test -w @scribble/server`.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { io } from 'socket.io-client'

const PORT = process.env.TEST_PORT ?? '4123'
const URL = `http://localhost:${PORT}`
const SERVER_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.ts')

let passed = 0
let failed = 0

/** Boots the server on a throwaway port so the test needs no setup. */
async function startServer() {
  const child = spawn('npx', ['tsx', SERVER_ENTRY], {
    env: { ...process.env, PORT, WEB_ORIGIN: URL },
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
      const res = await fetch(`${URL}/health`)
      if (res.ok) return child
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  child.kill('SIGKILL')
  throw new Error(`server did not become healthy\n${stderr}`)
}

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
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
    const done = (result) => resolve(result)
    if (payload === undefined) socket.emit(event, done)
    else socket.emit(event, payload, done)
  })
}

async function waitFor(predicate, label, timeoutMs = 2000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

const sockets = []
async function open(name) {
  const s = await connect(name)
  sockets.push(s)
  return s
}

const server = await startServer()

try {
  console.log('\n== create & join ==')
  const alice = await open('alice')
  const created = await emit(alice, 'room:create', { nickname: 'Alice' })
  check('create returns ok', created.ok, JSON.stringify(created))
  const code = created.data.snapshot.code
  check('code is 6 chars', code.length === 6, code)
  check('creator is host', created.data.snapshot.hostId === created.data.playerId)
  check('token issued', typeof created.data.token === 'string' && created.data.token.length > 10)
  check('token absent from snapshot', !JSON.stringify(created.data.snapshot).includes(created.data.token))

  const bob = await open('bob')
  const joined = await emit(bob, 'room:join', { code, nickname: 'Bob' })
  check('bob joins', joined.ok, JSON.stringify(joined))
  check('bob sees 2 players', joined.data.snapshot.players.length === 2)
  check('bob is not host', joined.data.snapshot.hostId !== joined.data.playerId)

  await waitFor(() => alice.state.snapshot?.players.length === 2, 'alice roster')
  check('alice roster broadcast', alice.state.snapshot.players.length === 2)
  check('alice saw join message', alice.state.messages.some((m) => m.text.includes('Bob joined')))
  check('players have distinct colors',
    new Set(alice.state.snapshot.players.map((p) => p.color)).size === 2)

  console.log('\n== lowercase code join ==')
  const carol = await open('carol')
  const lower = await emit(carol, 'room:join', { code: code.toLowerCase(), nickname: 'Carol' })
  check('lowercase code accepted', lower.ok, JSON.stringify(lower))

  console.log('\n== nickname collision ==')
  const dave = await open('dave')
  const dup = await emit(dave, 'room:join', { code, nickname: 'Bob' })
  check('duplicate nickname joins', dup.ok, JSON.stringify(dup))
  const daveName = dup.data.snapshot.players.find((p) => p.id === dup.data.playerId)?.nickname
  check('duplicate nickname disambiguated', daveName === 'Bob (2)', daveName)

  console.log('\n== settings authorization ==')
  const bobSettings = await emit(bob, 'room:settings', { rounds: 9 })
  check('non-host settings rejected', !bobSettings.ok, JSON.stringify(bobSettings))
  check('rejection explains why', /host/i.test(bobSettings.error ?? ''), bobSettings.error)

  const aliceSettings = await emit(alice, 'room:settings', { rounds: 5, drawTimeMs: 120000 })
  check('host settings accepted', aliceSettings.ok, JSON.stringify(aliceSettings))
  await waitFor(() => bob.state.snapshot?.settings.rounds === 5, 'settings broadcast')
  check('settings broadcast to all', bob.state.snapshot.settings.rounds === 5)

  console.log('\n== settings validation ==')
  const badRounds = await emit(alice, 'room:settings', { rounds: 999 })
  check('out-of-range rounds rejected', !badRounds.ok, JSON.stringify(badRounds))
  const badType = await emit(alice, 'room:settings', { rounds: 'five' })
  check('wrong-typed rounds rejected', !badType.ok, JSON.stringify(badType))
  const clamped = await emit(alice, 'room:settings', { maxPlayers: 2 })
  check('maxPlayers below roster clamps', clamped.ok, JSON.stringify(clamped))
  await waitFor(() => alice.state.snapshot?.settings.maxPlayers === 4, 'clamp broadcast')
  check('clamped to roster size', alice.state.snapshot.settings.maxPlayers === 4,
    String(alice.state.snapshot?.settings.maxPlayers))

  console.log('\n== room full ==')
  const eve = await open('eve')
  const full = await emit(eve, 'room:join', { code, nickname: 'Eve' })
  check('join beyond cap rejected', !full.ok, JSON.stringify(full))
  check('full error is clear', /full/i.test(full.error ?? ''), full.error)

  console.log('\n== bad input ==')
  const nf = await emit(eve, 'room:join', { code: 'ZZZZZZ', nickname: 'Eve' })
  check('unknown code rejected', !nf.ok && /no room/i.test(nf.error), JSON.stringify(nf))
  const shortCode = await emit(eve, 'room:join', { code: 'AB', nickname: 'Eve' })
  check('short code rejected', !shortCode.ok, JSON.stringify(shortCode))
  const emptyNick = await emit(eve, 'room:join', { code, nickname: '   ' })
  check('blank nickname rejected', !emptyNick.ok, JSON.stringify(emptyNick))
  const junk = await emit(eve, 'room:create', null)
  check('null payload rejected', !junk.ok, JSON.stringify(junk))
  const longNick = await emit(eve, 'room:create', { nickname: 'x'.repeat(200) })
  check('oversized nickname rejected', !longNick.ok, JSON.stringify(longNick))

  console.log('\n== start guards ==')
  const bobStart = await emit(bob, 'game:start')
  check('non-host start rejected', !bobStart.ok && /host/i.test(bobStart.error), JSON.stringify(bobStart))
  const aliceStart = await emit(alice, 'game:start')
  check('host start accepted', aliceStart.ok, JSON.stringify(aliceStart))
  await waitFor(() => alice.state.snapshot?.phase === 'word-select', 'game started')
  check('game leaves the lobby', alice.state.snapshot.phase === 'word-select')

  const lockedSettings = await emit(alice, 'room:settings', { rounds: 2 })
  check('settings locked during play', !lockedSettings.ok, JSON.stringify(lockedSettings))
  const doubleStart = await emit(alice, 'game:start')
  check('second start rejected', !doubleStart.ok, JSON.stringify(doubleStart))

  const bobAbort = await emit(bob, 'game:abort')
  check('non-host abort rejected', !bobAbort.ok, JSON.stringify(bobAbort))
  const abort = await emit(alice, 'game:abort')
  check('host abort accepted', abort.ok, JSON.stringify(abort))
  await waitFor(() => alice.state.snapshot?.phase === 'lobby', 'back in lobby')
  check('abort returns to lobby', alice.state.snapshot.phase === 'lobby')
  check('scores reset on return', alice.state.snapshot.players.every((p) => p.score === 0))

  console.log('\n== clock sync ==')
  const time = await emit(alice, 'ping:time')
  check('ping:time responds', time.ok && typeof time.data.serverTime === 'number')
  check('serverTime is sane', Math.abs(time.data.serverTime - Date.now()) < 5000)

  console.log('\n== reconnect with token ==')
  const bobId = joined.data.playerId
  const bobToken = joined.data.token
  bob.disconnect()
  await waitFor(() => alice.state.snapshot?.players.find((p) => p.id === bobId)?.connected === false,
    'bob marked disconnected')
  check('dropped player marked disconnected',
    alice.state.snapshot.players.find((p) => p.id === bobId).connected === false)
  check('seat retained during grace', alice.state.snapshot.players.length === 4)

  const bob2 = await open('bob2')
  const reclaimed = await emit(bob2, 'room:join', { code, nickname: 'Whatever', token: bobToken })
  check('reclaim succeeds', reclaimed.ok, JSON.stringify(reclaimed))
  check('same playerId restored', reclaimed.data.playerId === bobId)
  check('nickname preserved on reclaim',
    reclaimed.data.snapshot.players.find((p) => p.id === bobId)?.nickname === 'Bob')
  check('no duplicate seat created', reclaimed.data.snapshot.players.length === 4,
    String(reclaimed.data.snapshot.players.length))
  await waitFor(() => alice.state.snapshot?.players.find((p) => p.id === bobId)?.connected === true,
    'bob reconnected')
  check('reconnect broadcast', alice.state.snapshot.players.find((p) => p.id === bobId).connected)

  console.log('\n== double join on same socket (StrictMode shape) ==')
  const before = reclaimed.data.snapshot.players.length
  const again = await emit(bob2, 'room:join', { code, nickname: 'Bob', token: bobToken })
  check('re-join same seat is idempotent', again.ok && again.data.playerId === bobId,
    JSON.stringify(again))
  check('roster size unchanged', again.data.snapshot.players.length === before,
    `${again.data.snapshot.players.length} vs ${before}`)

  console.log('\n== stale token falls through to fresh join ==')
  await emit(alice, 'room:settings', { maxPlayers: 8 })
  const frank = await open('frank')
  const stale = await emit(frank, 'room:join', { code, nickname: 'Frank', token: 'not-a-real-token' })
  check('stale token joins fresh', stale.ok, JSON.stringify(stale))
  check('fresh seat has new id', stale.ok && stale.data.playerId !== bobId)

  console.log('\n== kick ==')
  const kick = await emit(alice, 'player:kick', { playerId: stale.data.playerId })
  check('host kick accepted', kick.ok, JSON.stringify(kick))
  await waitFor(() => frank.state.closed !== null, 'frank closed')
  check('kicked player notified', /removed/i.test(frank.state.closed ?? ''), frank.state.closed)
  const selfKick = await emit(alice, 'player:kick', { playerId: created.data.playerId })
  check('self-kick rejected', !selfKick.ok, JSON.stringify(selfKick))
  const bobKick = await emit(bob2, 'player:kick', { playerId: created.data.playerId })
  check('non-host kick rejected', !bobKick.ok, JSON.stringify(bobKick))

  console.log('\n== host handoff on leave ==')
  const rosterBefore = alice.state.snapshot.players.length
  alice.emit('room:leave')
  await waitFor(() => bob2.state.snapshot?.players.length === rosterBefore - 1, 'alice removed')
  check('leaver removed immediately', bob2.state.snapshot.players.length === rosterBefore - 1)
  const newHost = bob2.state.snapshot.hostId
  check('host reassigned', newHost !== created.data.playerId && newHost !== null, String(newHost))
  check('new host is a live player',
    bob2.state.snapshot.players.some((p) => p.id === newHost && p.connected))

  // The promoted host must actually be able to exercise host-only powers.
  const promoted = newHost === bobId ? bob2 : null
  if (promoted) {
    const promotedSettings = await emit(promoted, 'room:settings', { rounds: 7 })
    check('promoted host can change settings', promotedSettings.ok,
      JSON.stringify(promotedSettings))
  } else {
    check('promoted host is bob (next in turn order)', false, String(newHost))
  }
} catch (error) {
  failed += 1
  console.log(`\n  ERROR  ${error.stack ?? error.message}`)
} finally {
  for (const s of sockets) s.disconnect()
  server.kill('SIGKILL')
  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}
