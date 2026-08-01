import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@scribble/shared'

/** Client type params are <Listen, Emit> — the mirror of the server's. */
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4500'

let socket: AppSocket | null = null

/**
 * One socket for the whole tab, created lazily. Navigating between the home
 * page and a room must not tear down the connection — the seat lives on the
 * server keyed by socket, so a reconnect would mean re-joining.
 */
export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4_000,
    })
  }
  return socket
}
