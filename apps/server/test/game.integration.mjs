/**
 * Full gameplay: the round state machine, drawing relay, guessing, scoring, and
 * the anti-leak rules. Phase timings are compressed via env so a whole
 * multi-round game runs in seconds.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { io } from 'socket.io-client'

const PORT = process.env.TEST_PORT ?? '4125'
const URL = `http://localhost:${PORT}`
const SERVER_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.ts')

const WORD_SELECT_MS = 600
const DRAW_TIME_MS = 2500
const ROUND_END_MS = 300
const GAME_END_MS = 500

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
      WORD_SELECT_MS: String(WORD_SELECT_MS),
      DRAW_TIME_MS: String(DRAW_TIME_MS),
      ROUND_END_MS: String(ROUND_END_MS),
      GAME_END_MS: String(GAME_END_MS),
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

const sockets = []

function connect(name) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], reconnection: false })
    socket.state = {
      name,
      snapshot: null,
      messages: [],
      closed: null,
      offer: null,
      word: null,
      strokes: [],
      appends: [],
      ends: [],
      undos: [],
      clears: 0,
      syncs: [],
    }
    socket.on('room:state', (s) => { socket.state.snapshot = s })
    socket.on('feed:message', (m) => { socket.state.messages.push(m) })
    socket.on('room:closed', (r) => { socket.state.closed = r })
    socket.on('word:options', (o) => { socket.state.offer = o })
    socket.on('word:assigned', ({ word }) => { socket.state.word = word })
    socket.on('draw:begin', (s) => { socket.state.strokes.push(s) })
    socket.on('draw:append', (p) => { socket.state.appends.push(p) })
    socket.on('draw:end', (p) => { socket.state.ends.push(p) })
    socket.on('draw:undo', (p) => { socket.state.undos.push(p) })
    socket.on('draw:clear', () => { socket.state.clears += 1 })
    socket.on('canvas:sync', (p) => { socket.state.syncs.push(p) })
    socket.on('connect', () => resolve(socket))
    socket.on('connect_error', reject)
    setTimeout(() => reject(new Error(`${name} connect timeout`)), 5000)
  })
}

async function open(name) {
  const s = await connect(name)
  sockets.push(s)
  return s
}

function emit(socket, event, payload) {
  return new Promise((resolve) => {
    if (payload === undefined) socket.emit(event, resolve)
    else socket.emit(event, payload, resolve)
  })
}

async function waitFor(predicate, label, timeoutMs = 6000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** Resolves the socket whose seat is currently drawing. */
function drawerOf(clients) {
  const drawerId = clients[0].state.snapshot?.drawerId
  return clients.find((c) => c.playerId === drawerId)
}

function guessersOf(clients) {
  const drawerId = clients[0].state.snapshot?.drawerId
  return clients.filter((c) => c.playerId !== drawerId)
}

const server = await startServer()

try {
  // ---------------------------------------------------------------------------
  console.log('\n== setup ==')
  const alice = await open('alice')
  const created = await emit(alice, 'room:create', { nickname: 'Alice' })
  alice.playerId = created.data.playerId
  const code = created.data.snapshot.code

  const bob = await open('bob')
  bob.playerId = (await emit(bob, 'room:join', { code, nickname: 'Bob' })).data.playerId
  const carol = await open('carol')
  carol.playerId = (await emit(carol, 'room:join', { code, nickname: 'Carol' })).data.playerId

  const clients = [alice, bob, carol]
  await emit(alice, 'room:settings', { rounds: 1 })
  await waitFor(() => alice.state.snapshot?.settings.rounds === 1, 'rounds set')

  // ---------------------------------------------------------------------------
  console.log('\n== word selection ==')
  await emit(alice, 'game:start')
  await waitFor(
    () => clients.every((c) => c.state.snapshot?.phase === 'word-select'),
    'all clients in word-select',
  )
  check('phase is word-select', alice.state.snapshot.phase === 'word-select')
  check('round is 1', alice.state.snapshot.round === 1)
  check('a drawer was chosen', typeof alice.state.snapshot.drawerId === 'string')

  const drawer = drawerOf(clients)
  const guessers = guessersOf(clients)
  check('drawer resolved', Boolean(drawer))

  await waitFor(() => drawer.state.offer !== null, 'drawer offer')
  check('drawer receives options', drawer.state.offer.words.length === 3)
  check('options are non-empty strings',
    drawer.state.offer.words.every((w) => typeof w === 'string' && w.length > 0))
  check('non-drawers get NO options', guessers.every((g) => g.state.offer === null))
  check('nobody has the word yet', clients.every((c) => c.state.word === null))
  check('snapshot carries no plaintext word',
    !('word' in alice.state.snapshot), Object.keys(alice.state.snapshot).join(','))

  console.log('\n== only the drawer may choose ==')
  const wrongChooser = await emit(guessers[0], 'word:choose', { index: 0 })
  check('non-drawer choose rejected', !wrongChooser.ok, JSON.stringify(wrongChooser))
  const badIndex = await emit(drawer, 'word:choose', { index: 99 })
  check('out-of-range index rejected', !badIndex.ok, JSON.stringify(badIndex))

  // ---------------------------------------------------------------------------
  console.log('\n== drawing phase ==')
  const chosenWord = drawer.state.offer.words[1]
  const choice = await emit(drawer, 'word:choose', { index: 1 })
  check('drawer choose accepted', choice.ok, JSON.stringify(choice))

  await waitFor(
    () => clients.every((c) => c.state.snapshot?.phase === 'drawing'),
    'all clients in drawing',
  )
  check('phase is drawing', alice.state.snapshot.phase === 'drawing')
  check('drawer learns the word', drawer.state.word === chosenWord, String(drawer.state.word))
  check('guessers never learn the word',
    guessers.every((g) => g.state.word === null))

  const pattern = guessers[0].state.snapshot.wordPattern
  check('pattern is masked', pattern.includes('_'), pattern)
  check('pattern length matches word', pattern.length === chosenWord.length, pattern)
  check('pattern keeps spaces visible',
    [...chosenWord].every((ch, i) => (ch === ' ' || ch === '-' ? pattern[i] === ch : true)),
    `${chosenWord} -> ${pattern}`)
  check('pattern hides letters',
    ![...chosenWord].every((ch, i) => pattern[i] === ch), pattern)
  check('draw time honours the override',
    Math.abs(alice.state.snapshot.phaseDurationMs - DRAW_TIME_MS) < 50,
    String(alice.state.snapshot.phaseDurationMs))

  // ---------------------------------------------------------------------------
  console.log('\n== stroke relay ==')
  const strokeId = 'stroke-a'
  drawer.emit('draw:begin', {
    id: strokeId, tool: 'brush', color: '#ff0000', width: 0.01,
    points: [{ x: 0.1, y: 0.1 }],
  })
  await waitFor(() => guessers[0].state.strokes.length === 1, 'stroke relayed')
  check('stroke reaches guessers', guessers[0].state.strokes.length === 1)
  check('stroke keeps its properties',
    guessers[0].state.strokes[0].color === '#ff0000' &&
    guessers[0].state.strokes[0].tool === 'brush')
  check('drawer gets no echo of its own stroke', drawer.state.strokes.length === 0)

  drawer.emit('draw:append', { id: strokeId, points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }] })
  await waitFor(() => guessers[0].state.appends.length === 1, 'append relayed')
  check('appends relay', guessers[0].state.appends[0].points.length === 2)

  drawer.emit('draw:end', { id: strokeId })
  await waitFor(() => guessers[0].state.ends.length === 1, 'end relayed')
  check('stroke end relays', guessers[0].state.ends[0].id === strokeId)

  console.log('\n== non-drawers cannot draw ==')
  guessers[0].emit('draw:begin', {
    id: 'hacker', tool: 'brush', color: '#00ff00', width: 0.01,
    points: [{ x: 0.5, y: 0.5 }],
  })
  await new Promise((r) => setTimeout(r, 250))
  check('guesser stroke ignored',
    !guessers[1].state.strokes.some((s) => s.id === 'hacker'))
  check('guesser clear ignored', (() => {
    const before = guessers[1].state.clears
    guessers[0].emit('draw:clear')
    return guessers[1].state.clears === before
  })())

  console.log('\n== malformed stroke payloads ==')
  drawer.emit('draw:begin', { id: 'bad-color', tool: 'brush', color: 'red', width: 0.01, points: [{ x: 0, y: 0 }] })
  drawer.emit('draw:begin', { id: 'bad-point', tool: 'brush', color: '#000000', width: 0.01, points: [{ x: 50, y: 0 }] })
  drawer.emit('draw:begin', { id: 'bad-tool', tool: 'laser', color: '#000000', width: 0.01, points: [{ x: 0, y: 0 }] })
  await new Promise((r) => setTimeout(r, 250))
  check('invalid strokes dropped',
    !guessers[0].state.strokes.some((s) => ['bad-color', 'bad-point', 'bad-tool'].includes(s.id)),
    guessers[0].state.strokes.map((s) => s.id).join(','))

  console.log('\n== late joiner canvas sync ==')
  drawer.emit('draw:begin', {
    id: 'stroke-b', tool: 'brush', color: '#0000ff', width: 0.02,
    points: [{ x: 0.4, y: 0.4 }],
  })
  await waitFor(() => guessers[0].state.strokes.length === 2, 'second stroke')

  const dave = await open('dave')
  dave.playerId = (await emit(dave, 'room:join', { code, nickname: 'Dave' })).data.playerId
  await waitFor(() => dave.state.syncs.length === 1, 'canvas sync')
  check('late joiner receives history', dave.state.syncs[0].strokes.length === 2,
    String(dave.state.syncs[0].strokes.length))
  check('late joiner gets no word', dave.state.word === null)
  check('late joiner sees the mask', typeof dave.state.snapshot.wordPattern === 'string')

  console.log('\n== undo ==')
  drawer.emit('draw:undo')
  await waitFor(() => guessers[0].state.undos.length === 1, 'undo relayed')
  check('undo names the removed stroke', guessers[0].state.undos[0].id === 'stroke-b')

  // ---------------------------------------------------------------------------
  console.log('\n== guessing ==')
  guessers[0].emit('chat:message', { text: 'definitely not the word' })
  await waitFor(
    () => guessers[1].state.messages.some((m) => m.text === 'definitely not the word'),
    'wrong guess broadcast',
  )
  check('wrong guesses are broadcast as chat', true)
  check('wrong guess did not score',
    guessers[0].state.snapshot.players.find((p) => p.id === guessers[0].playerId).score === 0)

  console.log('\n== drawer cannot say the word ==')
  const beforeDrawerChat = guessers[0].state.messages.length
  drawer.emit('chat:message', { text: `it is a ${chosenWord}` })
  await new Promise((r) => setTimeout(r, 250))
  check('word-bearing drawer message blocked',
    !guessers[0].state.messages.some((m) => m.text.includes(chosenWord)),
    `${beforeDrawerChat} -> ${guessers[0].state.messages.length}`)
  check('drawer is warned privately',
    drawer.state.messages.some((m) => m.kind === 'warning'),
    drawer.state.messages.map((m) => m.kind).join(','))

  console.log('\n== close guess ==')
  // Mutate one letter to land inside the edit-distance tolerance.
  const near = chosenWord.slice(0, -1) + (chosenWord.endsWith('z') ? 'y' : 'z')
  guessers[0].emit('chat:message', { text: near })
  await waitFor(
    () => guessers[0].state.messages.some((m) => m.kind === 'close'),
    'close nudge',
  )
  check('near miss nudges the guesser privately',
    guessers[0].state.messages.some((m) => m.kind === 'close'))
  check('nudge stays private',
    !guessers[1].state.messages.some((m) => m.kind === 'close'))

  console.log('\n== correct guess ==')
  guessers[0].emit('chat:message', { text: chosenWord.toUpperCase() })
  await waitFor(
    () => guessers[0].state.snapshot?.players.find((p) => p.id === guessers[0].playerId)?.hasGuessed,
    'guess registered',
  )
  const scorer = guessers[0].state.snapshot.players.find((p) => p.id === guessers[0].playerId)
  check('case-insensitive guess accepted', scorer.hasGuessed)
  check('guesser scored', scorer.score > 0, String(scorer.score))
  check('correct guess NOT echoed as chat',
    !guessers[1].state.messages.some(
      (m) => m.kind === 'chat' && m.text.toLowerCase() === chosenWord.toLowerCase(),
    ))
  check('room told someone got it',
    guessers[1].state.messages.some((m) => m.kind === 'correct'))
  check('the announcement omits the word',
    guessers[1].state.messages
      .filter((m) => m.kind === 'correct')
      .every((m) => !m.text.toLowerCase().includes(chosenWord.toLowerCase())))

  console.log('\n== post-guess chat is walled off ==')
  const outsider = guessers[1]
  const outsiderBefore = outsider.state.messages.length
  guessers[0].emit('chat:message', { text: 'it was so obvious lol' })
  await waitFor(
    () => drawer.state.messages.some((m) => m.text === 'it was so obvious lol'),
    'insider chat reaches drawer',
  )
  check('drawer sees insider chat', true)
  check('still-guessing players do not',
    !outsider.state.messages.some((m) => m.text === 'it was so obvious lol'),
    `${outsiderBefore} -> ${outsider.state.messages.length}`)

  // ---------------------------------------------------------------------------
  console.log('\n== turn ends when everyone has it ==')
  for (const g of guessersOf(clients.concat(dave))) {
    if (!g.state.snapshot.players.find((p) => p.id === g.playerId)?.hasGuessed) {
      g.emit('chat:message', { text: chosenWord })
    }
  }

  await waitFor(() => alice.state.snapshot?.phase === 'round-end', 'round-end')
  check('turn ends early once all have guessed',
    alice.state.snapshot.phase === 'round-end')

  const result = alice.state.snapshot.roundResult
  check('result reveals the word', result.word === chosenWord, String(result?.word))
  check('result counts the guessers', result.guessedCount >= 2, String(result?.guessedCount))
  check('result carries score deltas', result.deltas.length > 0)
  const drawerDelta = result.deltas.find((d) => d.playerId === drawer.playerId)
  check('drawer earned from the guesses', drawerDelta && drawerDelta.delta > 0,
    JSON.stringify(drawerDelta))
  check('word now public in the reveal',
    alice.state.messages.some((m) => m.text.includes(chosenWord)))

  // ---------------------------------------------------------------------------
  console.log('\n== game completes and returns to lobby ==')
  await waitFor(() => alice.state.snapshot?.phase === 'game-end', 'game-end', 25000)
  check('reaches game-end', alice.state.snapshot.phase === 'game-end')
  check('a winner was announced',
    alice.state.messages.some((m) => /wins with|Game over/.test(m.text)))
  check('canvas cleared at game end', alice.state.snapshot.drawerId === null)

  await waitFor(() => alice.state.snapshot?.phase === 'lobby', 'back to lobby', 8000)
  check('returns to the lobby', alice.state.snapshot.phase === 'lobby')
  check('round counter reset', alice.state.snapshot.round === 0)
  check('no word pattern in the lobby', alice.state.snapshot.wordPattern === null)
  check('scores persisted into the lobby view',
    alice.state.snapshot.players.some((p) => p.score > 0))

  // ---------------------------------------------------------------------------
  console.log('\n== drawer leaving ends the turn ==')
  const all = [alice, bob, carol, dave]
  await emit(alice, 'room:settings', { rounds: 3 })
  await emit(alice, 'game:start')
  await waitFor(
    () => all.every((c) => c.state.snapshot?.phase === 'word-select'),
    'all clients in second word-select',
  )

  const drawer2 = drawerOf(all)
  await waitFor(() => drawer2.state.offer !== null, 'second offer')
  await emit(drawer2, 'word:choose', { index: 0 })
  await waitFor(
    () => all.every((c) => c.state.snapshot?.phase === 'drawing'),
    'all clients in second drawing',
  )

  const watcher = all.find((c) => c !== drawer2)
  drawer2.disconnect()
  await waitFor(
    () => watcher.state.snapshot?.phase === 'round-end' ||
          watcher.state.snapshot?.drawerId !== drawer2.playerId,
    'turn advanced past the departed drawer',
  )
  check('losing the drawer does not stall the turn', true)

  console.log('\n== dropping below the minimum aborts ==')
  const remaining = all.filter((c) => c !== drawer2)
  remaining[0].disconnect()
  remaining[1].disconnect()
  await waitFor(() => remaining[2].state.snapshot?.phase === 'lobby', 'aborted to lobby', 8000)
  check('game aborts back to the lobby below minimum players',
    remaining[2].state.snapshot.phase === 'lobby')
} catch (error) {
  failed += 1
  console.log(`\n  ERROR  ${error.stack ?? error.message}`)
} finally {
  for (const s of sockets) s.disconnect()
  server.kill('SIGKILL')
  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}
