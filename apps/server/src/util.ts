import type { z } from 'zod'
import type { Ack, Result } from '@scribble/shared'

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail(error: string): Result<never> {
  return { ok: false, error }
}

/**
 * Socket.IO drops the callback argument entirely when the client emits without
 * one, so every ack has to be treated as possibly-absent.
 */
export function respond<T>(ack: Ack<T> | undefined, result: Result<T>): void {
  if (typeof ack === 'function') ack(result)
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/** Surfaces the first zod issue, which is the one worth showing a user. */
export function parse<S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown,
): ParseResult<z.output<S>> {
  const result = schema.safeParse(payload)
  if (result.success) return { ok: true, data: result.data }
  return { ok: false, error: result.error.issues[0]?.message ?? 'Invalid request' }
}

/**
 * Token bucket, one per socket per action class. Cheap insurance against a
 * client looping an emit — the drawing events in M2 will lean on this hard.
 */
export class RateLimiter {
  private tokens: number
  private lastRefill = Date.now()

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity
  }

  take(cost = 1): boolean {
    const now = Date.now()
    const elapsedSeconds = (now - this.lastRefill) / 1000
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSeconds * this.refillPerSecond,
    )
    this.lastRefill = now

    if (this.tokens < cost) return false
    this.tokens -= cost
    return true
  }
}
