# Scribble

A multiplayer draw-and-guess game. Next.js frontend, standalone Node realtime server.

## Why two processes

Next.js on a serverless host can't hold persistent WebSocket connections, and this
game needs long-lived sockets plus authoritative in-memory state with server-side
timers. So the UI and the realtime layer are separate deployables that talk over a
single WebSocket. The frontend keeps its CDN/edge story; the game server can be
restarted and scaled on its own.

## Layout

```
apps/web       Next.js 16 (App Router, Tailwind 4, Zustand)
apps/server    Node + Socket.IO — owns all game state
packages/shared  Event schemas, types, constants, word pool
```

`shared` ships raw TypeScript with no build step. The server runs it through `tsx`;
Next compiles it via `transpilePackages`. Every socket payload has a zod schema
there, so a client/server protocol drift is a compile error rather than a
production bug.

## Running it

```bash
npm install
npm run dev          # web on :3400, realtime server on :4500
```

Open http://localhost:3400 in two windows to play against yourself.

Ports are pinned deliberately (3400 / 4500) to stay clear of the 3000-3002 and
4000 range that other local services commonly occupy. In development the server
accepts any localhost origin, so changing the web port needs no server change.

Point the web app at a different server with `apps/web/.env.local`:

```
NEXT_PUBLIC_SERVER_URL=http://localhost:4500
```

## Tests

```bash
npm test -w @scribble/server   # 129 checks against a real server process
npm run typecheck              # all three workspaces
```

Three suites, each booting its own server on a throwaway port:

| Suite | Covers |
|---|---|
| `lobby.integration.mjs` | rooms, join/reconnect, settings, kick, host handoff |
| `sweep.integration.mjs` | seat expiry and empty-room GC, timings compressed |
| `game.integration.mjs` | round machine, stroke relay, guessing, scoring, leak rules |

## Design decisions worth knowing

**The server is the only writer of game state.** Clients replace their local
snapshot wholesale on every `room:state`; they never merge or predict. The one
exception is the drawer's own strokes, which render locally before the round trip —
waiting on the network to see your own line is the worst thing a drawing tool can
do.

**The plaintext word never leaves the drawer's socket.** It is deliberately absent
from `RoomSnapshot`, so there is no code path that could broadcast it. Everyone
else receives `wordPattern`, a mask the server computes. A correct guess is
announced as `"<name> guessed the word!"` — the guessed text is never echoed, so
players still working on it learn nothing. Players who have already solved it are
routed into a separate chat visible only to each other and the drawer.

**Canvas state lives outside React.** Stroke batches arrive ~20×/second; a React
state update per batch would re-render the whole game view. `lib/drawing.ts` is a
plain observable the canvas subscribes to imperatively. Strokes split into a
committed base layer (painted once, appended to) and a live layer (repainted per
frame), so a long drawing costs nothing to keep on screen.

**Coordinates are normalized to a fixed 4:3 canvas.** Every client sees the same
picture regardless of viewport, and stroke width is a fraction of canvas width, so
line weight scales too.

**Reconnect tokens, not session cookies.** A seat is claimed by a secret token
held in `localStorage`; tokens never appear in a snapshot. A dropped player keeps
their seat and score for 30s. A returning drawer is re-sent their word and the
full stroke history, since neither is in the snapshot.

**Timers ship deadlines, not ticks.** Phases carry an `endsAt` server timestamp
and clients derive a clock offset from one `ping:time` round trip. No per-second
countdown broadcast, no drift.

**Nothing waits on a client.** Every phase has a server timer behind it. A drawer
who never picks a word gets one chosen for them; a drawer who disconnects ends the
turn; dropping below two players returns the room to the lobby.

## Configuration

Server env (see `apps/server/.env.example`). All optional except `WEB_ORIGIN` in
production:

| Var | Purpose |
|---|---|
| `PORT` | listen port (default 4500) |
| `WEB_ORIGIN` | comma-separated allowed origins; **required in production** |
| `WORD_SELECT_MS` `ROUND_END_MS` `GAME_END_MS` | phase durations |
| `DRAW_TIME_MS` | overrides the room's own draw-time setting |
| `RECONNECT_GRACE_MS` `EMPTY_ROOM_TTL_MS` `SWEEP_INTERVAL_MS` | lifecycle timings |

## Status

Playable end to end. Done: **M0** (workspaces, protocol), **M1** (rooms, lobby,
settings, kick, reconnect, GC), **M2** (canvas, stroke relay, undo/clear, late-join
sync), **M3** (round machine, word selection, progressive hints), **M4** (guessing,
scoring, scoreboards).

Remaining:

- **M5** — polish: flood fill, custom colour picker, sounds, avatars, mobile
  layout pass, spectator mode for mid-game joiners
- **M6** — hardening and deploy: Redis adapter for multi-instance, metrics,
  abuse reporting

Deliberately deferred: no database. Room state is ephemeral by nature — a finished
game has nothing worth persisting. Add Postgres when you want accounts or
lifetime stats.

### Known gaps

- Flood fill is not implemented. It needs pixel-level operations that rasterize
  differently across devices, so a naive version would diverge between clients —
  it wants a deterministic scanline fill replayed from the stroke log, not a
  `getImageData` fill.
- Mid-game joiners can guess immediately but aren't added to the turn queue until
  the next round.
- The browser UI has not been click-tested by me (no browser tooling available in
  this environment); it typechecks, builds, and the protocol beneath it is covered
  by 129 tests.

## Deployment

Two deployables, two hosts:

**`apps/web` → Vercel.** New project, set Root Directory to `apps/web` (Vercel
detects the npm workspace and installs from the repo root automatically). Set
`NEXT_PUBLIC_SERVER_URL` to the server's public URL.

**`apps/server` → Railway.** New project from this repo, leave Root Directory
unset (must build from the repo root so the `@scribble/shared` workspace
resolves). `railway.json` at the repo root pins the build to `npm install` and
the start command to `npm run start -w @scribble/server` — without it, Railway's
Nixpacks would auto-run the root `build` script, which only builds `apps/web`.
Set `WEB_ORIGIN` to the Vercel URL; production refuses browser origins that
aren't listed. Railway injects its own `PORT`, which `apps/server/src/index.ts`
already reads.

Note `tsx` lives in `apps/server`'s `dependencies`, not `devDependencies` — the
`start` script runs TypeScript directly through it, so a production install that
prunes dev deps would otherwise break boot.

Beyond one server instance, add the Socket.IO Redis adapter — the transport is
already pinned to `websocket`, so sticky sessions aren't a concern.
