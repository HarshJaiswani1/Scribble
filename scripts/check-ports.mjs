/**
 * Preflight for `npm run dev`.
 *
 * A dev server binding 0.0.0.0 will happily start even when something else
 * already holds 127.0.0.1 on the same port — macOS allows the wildcard bind
 * alongside the specific one. But `localhost` resolves to the loopback address,
 * where the more specific listener wins, so every browser request lands on the
 * squatter. Docker port mappings do exactly this, and the symptom is a bare
 * 404 from a server you never wrote.
 *
 * So test the interface that browsers actually reach, and name the culprit.
 */
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'

const PORTS = [
  { port: 3400, label: 'web (apps/web)' },
  { port: 4500, label: 'realtime server (apps/server)' },
]

function isFree(port, host) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, host)
  })
}

/** Best-effort: who holds this port? Purely for the error message. */
function whoHolds(port) {
  try {
    const out = execFileSync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const line = out.split('\n')[1]
    if (!line) return null
    const [command, pid] = line.split(/\s+/)
    return `${command} (pid ${pid})`
  } catch {
    return null
  }
}

const problems = []

for (const { port, label } of PORTS) {
  // 127.0.0.1 is the one that matters; a wildcard-only check would pass here.
  if (await isFree(port, '127.0.0.1')) continue

  const holder = whoHolds(port)
  problems.push(
    `  :${port} — needed for ${label}\n` +
      `      held on 127.0.0.1 by ${holder ?? 'an unknown process'}`,
  )
}

if (problems.length > 0) {
  console.error(
    `\n  Cannot start: port already in use on loopback.\n\n${problems.join('\n')}\n\n` +
      `  Free the port, or override:\n` +
      `    web     npm run dev -w @scribble/web -- --port <port>\n` +
      `    server  PORT=<port> npm run dev:server\n\n` +
      `  If you change the web port, nothing else needs updating — the server\n` +
      `  accepts any localhost origin in development.\n`,
  )
  process.exit(1)
}
