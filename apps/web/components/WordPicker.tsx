'use client'

import { getSocket } from '@/lib/socket'
import { useAppStore, useIsDrawer } from '@/lib/store'
import { useCountdown } from '@/lib/useCountdown'

/**
 * Shown over the canvas during 'word-select'. The drawer picks; everyone else
 * waits. If the drawer stalls, the server picks for them — so this overlay can
 * never wedge the room.
 */
export default function WordPicker() {
  const offer = useAppStore((s) => s.wordOffer)
  const snapshot = useAppStore((s) => s.snapshot)
  const offsetMs = useAppStore((s) => s.clockOffsetMs)
  const isDrawer = useIsDrawer()

  const remainingMs = useCountdown(snapshot?.endsAt ?? null, offsetMs)
  const seconds = Math.ceil(remainingMs / 1000)

  const drawer = snapshot?.players.find((p) => p.id === snapshot.drawerId)

  function choose(index: number) {
    getSocket().emit('word:choose', { index }, () => {
      // The authoritative phase change arrives via room:state regardless.
    })
  }

  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-ink-950/80 backdrop-blur-sm">
      {isDrawer && offer ? (
        <div className="flex flex-col items-center gap-5 px-6 text-center">
          <div>
            <p className="text-sm uppercase tracking-wider text-ink-400">
              Pick a word
            </p>
            <p className="tabular mt-1 text-3xl font-black">{seconds}</p>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {offer.words.map((word, index) => (
              <button
                key={word}
                onClick={() => choose(index)}
                className="rounded-xl bg-ink-700 px-5 py-3 text-base font-bold text-slate-100 transition-colors hover:bg-brand-500 hover:text-white"
              >
                {word}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-lg font-semibold">
            {drawer ? `${drawer.nickname} is picking a word` : 'Picking a word'}
          </p>
          <p className="tabular text-sm text-ink-400">{seconds}s</p>
        </div>
      )}
    </div>
  )
}
