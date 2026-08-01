/**
 * Nickname and seat credentials persist in localStorage so a refresh returns
 * you to the same seat with your score intact.
 */

const NICKNAME_KEY = 'scribble:nickname'
const seatKey = (code: string) => `scribble:seat:${code.toUpperCase()}`

export interface StoredSeat {
  playerId: string
  token: string
}

function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    // Private-mode Safari and hardened settings can throw on access.
    return null
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* non-fatal: the session just won't survive a refresh */
  }
}

function safeRemove(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* non-fatal */
  }
}

export function loadNickname(): string {
  return safeGet(NICKNAME_KEY) ?? ''
}

export function saveNickname(nickname: string): void {
  safeSet(NICKNAME_KEY, nickname)
}

export function loadSeat(code: string): StoredSeat | null {
  const raw = safeGet(seatKey(code))
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'playerId' in parsed &&
      'token' in parsed &&
      typeof parsed.playerId === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return { playerId: parsed.playerId, token: parsed.token }
    }
  } catch {
    /* fall through — a corrupt entry is the same as none */
  }
  safeRemove(seatKey(code))
  return null
}

export function saveSeat(code: string, seat: StoredSeat): void {
  safeSet(seatKey(code), JSON.stringify(seat))
}

export function clearSeat(code: string): void {
  safeRemove(seatKey(code))
}
