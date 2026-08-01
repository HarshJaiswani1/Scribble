'use client'

import { useEffect, useState } from 'react'

/** 10Hz — smooth enough for a progress bar, cheap enough to not matter. */
const TICK_MS = 100

/**
 * Derives remaining time locally from a server deadline. The server never
 * broadcasts a per-second countdown; it ships `endsAt` once and clients apply
 * their measured clock offset, so nothing drifts and nothing spams the room.
 */
export function useCountdown(endsAt: number | null, offsetMs: number): number {
  const [remainingMs, setRemainingMs] = useState(() =>
    endsAt === null ? 0 : Math.max(0, endsAt - (Date.now() + offsetMs)),
  )

  useEffect(() => {
    if (endsAt === null) {
      setRemainingMs(0)
      return
    }

    const update = () => {
      setRemainingMs(Math.max(0, endsAt - (Date.now() + offsetMs)))
    }

    update()
    const timer = window.setInterval(update, TICK_MS)
    return () => window.clearInterval(timer)
  }, [endsAt, offsetMs])

  return remainingMs
}
