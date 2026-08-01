let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  return ctx
}

/**
 * Plays a short sequence of tones, synthesized so there's no audio asset to
 * ship, license, or fetch. By the time any game cue fires the page has
 * already had a user gesture (joining the room), so autoplay policies don't
 * block it.
 */
function playTones(
  freqs: number[],
  { gapMs = 90, durMs = 220, peakGain = 0.2, type = 'sine' }: {
    gapMs?: number
    durMs?: number
    peakGain?: number
    type?: OscillatorType
  } = {},
) {
  const audioCtx = getContext()
  if (!audioCtx) return
  if (audioCtx.state === 'suspended') void audioCtx.resume()

  const now = audioCtx.currentTime
  const gap = gapMs / 1000
  const dur = durMs / 1000

  freqs.forEach((freq, i) => {
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = type
    osc.frequency.value = freq

    const start = now + i * gap
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(peakGain, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)

    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start(start)
    osc.stop(start + dur + 0.02)
  })
}

/** Someone guessed the word — a bright two-note ding. */
export function playCorrectGuessChime() {
  playTones([880, 1318.51], { gapMs: 90, durMs: 220 })
}

/** A new drawer is about to pick a word — a quick two-note heads-up. */
export function playNewTurnChime() {
  playTones([440, 659.25], { gapMs: 70, durMs: 150, peakGain: 0.14 })
}

/** The turn is over (time ran out or everyone guessed) — a mellow two-note drop. */
export function playRoundEndChime() {
  playTones([587.33, 392], { gapMs: 100, durMs: 260, peakGain: 0.16 })
}

/** Final scoreboard — a short three-note ascending fanfare. */
export function playGameEndChime() {
  playTones([523.25, 659.25, 783.99], { gapMs: 130, durMs: 320, peakGain: 0.2 })
}
