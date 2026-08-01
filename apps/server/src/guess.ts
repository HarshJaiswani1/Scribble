/**
 * Guess matching. All of this runs server-side only — the client never learns
 * the answer, so it cannot check a guess even if it wanted to.
 */

/**
 * Collapses a guess to comparable form: case, accents, punctuation and spacing
 * all stop mattering. "Ice-Cream!" and "ice cream" both become "icecream".
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    // Strip the combining marks NFD just split off, so "café" === "cafe".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export function isCorrect(guess: string, word: string): boolean {
  const a = normalize(guess)
  return a.length > 0 && a === normalize(word)
}

/**
 * Edit distance with an early bail-out. Callers only care about "within N", so
 * there's no reason to compute the full matrix for wildly different strings.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    let rowMin = curr[0]

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      // Non-null: both rows are fully populated for indices 0..b.length.
      const value = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      )
      curr[j] = value
      if (value < rowMin) rowMin = value
    }

    // Every remaining row can only grow, so this row deciding the bound ends it.
    if (rowMin > max) return max + 1

    const swap = prev
    prev = curr
    curr = swap
  }

  return prev[b.length]!
}

/** Longer words get more slack, since a single typo is likelier. */
function tolerance(word: string): number {
  return word.length >= 8 ? 2 : 1
}

/**
 * A near miss worth nudging the guesser about — close, but not correct. The
 * nudge goes only to that one player.
 */
export function isClose(guess: string, word: string): boolean {
  const a = normalize(guess)
  const b = normalize(word)
  if (a.length === 0 || a === b) return false

  const max = tolerance(b)
  const distance = editDistance(a, b, max)
  return distance > 0 && distance <= max
}

/**
 * Whether the drawer's chat message gives the answer away. Checks the whole
 * message collapsed (to catch "it's an ice cream") and each word separately
 * (to catch a near-spelling).
 */
export function mentionsWord(text: string, word: string): boolean {
  const target = normalize(word)
  if (target.length === 0) return false

  if (normalize(text).includes(target)) return true

  return text
    .split(/\s+/)
    .some((token) => isCorrect(token, word) || isClose(token, word))
}
