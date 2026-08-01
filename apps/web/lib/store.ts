import { create } from 'zustand'
import type { FeedMessage, RoomSnapshot } from '@scribble/shared'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'

/** The feed is display-only, so an old message is worth less than memory. */
const MAX_MESSAGES = 200

export interface WordOffer {
  words: string[]
  endsAt: number
}

interface AppState {
  status: ConnectionStatus
  snapshot: RoomSnapshot | null
  selfId: string | null
  /**
   * Which socket connection the seat was granted on. A reconnect mints a new
   * socket id, which is precisely the signal that we must re-join.
   */
  seatSocketId: string | null
  messages: FeedMessage[]
  /** serverNow - clientNow, so countdowns don't drift with a skewed clock. */
  clockOffsetMs: number
  /** Set when the server closes us out (kick, room GC). */
  closedReason: string | null

  /** The answer — present only when we are the drawer. */
  word: string | null
  /** Words on offer — present only when we are the drawer, mid word-select. */
  wordOffer: WordOffer | null

  setStatus: (status: ConnectionStatus) => void
  setSnapshot: (snapshot: RoomSnapshot) => void
  setSeat: (
    playerId: string,
    snapshot: RoomSnapshot,
    socketId: string | null,
  ) => void
  addMessage: (message: FeedMessage) => void
  setClockOffset: (offsetMs: number) => void
  setClosedReason: (reason: string | null) => void
  setWord: (word: string | null) => void
  setWordOffer: (offer: WordOffer | null) => void
  reset: () => void
}

export const useAppStore = create<AppState>((set) => ({
  status: 'idle',
  snapshot: null,
  selfId: null,
  seatSocketId: null,
  messages: [],
  clockOffsetMs: 0,
  closedReason: null,
  word: null,
  wordOffer: null,

  setStatus: (status) => set({ status }),

  // The private word and offer are scoped to their phase. Dropping them here
  // means a stale answer can never linger on screen into the next turn.
  setSnapshot: (snapshot) =>
    set((state) => ({
      snapshot,
      word: snapshot.phase === 'drawing' ? state.word : null,
      wordOffer: snapshot.phase === 'word-select' ? state.wordOffer : null,
    })),

  setSeat: (playerId, snapshot, socketId) =>
    set({
      selfId: playerId,
      snapshot,
      seatSocketId: socketId,
      closedReason: null,
    }),

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message].slice(-MAX_MESSAGES),
    })),

  setClockOffset: (clockOffsetMs) => set({ clockOffsetMs }),

  setClosedReason: (closedReason) => set({ closedReason }),

  setWord: (word) => set({ word }),

  setWordOffer: (wordOffer) => set({ wordOffer }),

  reset: () =>
    set({
      snapshot: null,
      selfId: null,
      seatSocketId: null,
      messages: [],
      closedReason: null,
      word: null,
      wordOffer: null,
    }),
}))

/** The local player's own row in the current snapshot, if seated. */
export function useSelf() {
  const selfId = useAppStore((s) => s.selfId)
  const players = useAppStore((s) => s.snapshot?.players)
  if (!selfId || !players) return null
  return players.find((p) => p.id === selfId) ?? null
}

export function useIsHost(): boolean {
  const selfId = useAppStore((s) => s.selfId)
  const hostId = useAppStore((s) => s.snapshot?.hostId)
  return Boolean(selfId && hostId && selfId === hostId)
}

export function useIsDrawer(): boolean {
  const selfId = useAppStore((s) => s.selfId)
  const drawerId = useAppStore((s) => s.snapshot?.drawerId)
  return Boolean(selfId && drawerId && selfId === drawerId)
}
