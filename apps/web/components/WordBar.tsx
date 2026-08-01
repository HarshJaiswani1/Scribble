'use client'

import { useAppStore, useIsDrawer } from '@/lib/store'
import { useCountdown } from '@/lib/useCountdown'

/**
 * Round header: the clock, and either the answer (drawer) or the mask
 * (everyone else). The mask arrives pre-computed from the server — the client
 * is never handed the word to hide for itself.
 */
export default function WordBar() {
  const snapshot = useAppStore((s) => s.snapshot)
  const offsetMs = useAppStore((s) => s.clockOffsetMs)
  const word = useAppStore((s) => s.word)
  const isDrawer = useIsDrawer()

  const remainingMs = useCountdown(snapshot?.endsAt ?? null, offsetMs)

  if (!snapshot) return null

  const seconds = Math.ceil(remainingMs / 1000)
  const duration = snapshot.phaseDurationMs ?? 0
  const fraction = duration > 0 ? Math.max(0, Math.min(1, remainingMs / duration)) : 0
  const urgent = snapshot.phase === 'drawing' && seconds <= 10

  const drawer = snapshot.players.find((p) => p.id === snapshot.drawerId)

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-ink-900/80 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="text-xs uppercase tracking-wider text-ink-400">
            Round {snapshot.round}/{snapshot.settings.rounds}
          </span>
          {drawer && (
            <span className="text-sm text-ink-400">
              {isDrawer ? (
                <span className="font-semibold text-brand-300">Your turn</span>
              ) : (
                <>
                  <span
                    className="font-semibold"
                    style={{ color: drawer.color }}
                  >
                    {drawer.nickname}
                  </span>{' '}
                  is drawing
                </>
              )}
            </span>
          )}
        </div>

        <span
          className={`tabular text-2xl font-black ${
            urgent ? 'text-rose-400' : 'text-slate-100'
          }`}
        >
          {seconds}
        </span>
      </div>

      <div className="flex items-center justify-center py-1">
        {snapshot.phase === 'drawing' ? (
          <p
            className="font-mono text-xl font-bold tracking-[0.35em] text-slate-100 sm:text-2xl"
            aria-label={isDrawer ? `Your word is ${word}` : 'Word to guess'}
          >
            {isDrawer ? (word ?? '…') : (snapshot.wordPattern ?? '')}
          </p>
        ) : (
          <p className="text-sm text-ink-400">
            {snapshot.phase === 'word-select'
              ? 'Picking a word…'
              : 'Between turns'}
          </p>
        )}
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-white/8">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ease-linear ${
            urgent ? 'bg-rose-400' : 'bg-brand-500'
          }`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  )
}
