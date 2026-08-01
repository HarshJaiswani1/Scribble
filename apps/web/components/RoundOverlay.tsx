'use client'

import { useAppStore } from '@/lib/store'
import { useCountdown } from '@/lib/useCountdown'

/**
 * The between-turns reveal and the final scoreboard. Both read from the same
 * snapshot fields, so a late joiner or a reconnect sees the same thing.
 */
export default function RoundOverlay() {
  const snapshot = useAppStore((s) => s.snapshot)
  const offsetMs = useAppStore((s) => s.clockOffsetMs)
  const remainingMs = useCountdown(snapshot?.endsAt ?? null, offsetMs)

  if (!snapshot) return null

  const isGameEnd = snapshot.phase === 'game-end'
  const result = snapshot.roundResult
  const seconds = Math.ceil(remainingMs / 1000)

  const deltaFor = (playerId: string) =>
    result?.deltas.find((d) => d.playerId === playerId)?.delta ?? 0

  const ranked = [...snapshot.players].sort((a, b) => b.score - a.score)

  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-ink-950/85 px-4 backdrop-blur-sm">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        {isGameEnd ? (
          <>
            <p className="text-xs uppercase tracking-wider text-ink-400">
              Final scores
            </p>
            <Podium ranked={ranked} />
          </>
        ) : (
          <>
            <div className="text-center">
              <p className="text-xs uppercase tracking-wider text-ink-400">
                The word was
              </p>
              <p className="mt-1 text-3xl font-black text-brand-300">
                {result?.word ?? '—'}
              </p>
              {result?.guessedCount === 0 && (
                <p className="mt-1 text-sm text-ink-400">Nobody got it</p>
              )}
            </div>

            <ul className="w-full flex-col gap-1">
              {ranked.map((player) => {
                const delta = deltaFor(player.id)
                return (
                  <li
                    key={player.id}
                    className="flex items-center gap-2.5 py-1 text-sm"
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: player.color }}
                    />
                    <span className="flex-1 truncate">{player.nickname}</span>
                    <span
                      className={
                        delta > 0
                          ? 'font-semibold text-emerald-300'
                          : 'text-ink-400'
                      }
                    >
                      {delta > 0 ? `+${delta}` : '—'}
                    </span>
                    <span className="w-12 text-right font-semibold tabular-nums">
                      {player.score}
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <p className="tabular text-xs text-ink-400">
          {isGameEnd ? `Back to the lobby in ${seconds}s` : `Next up in ${seconds}s`}
        </p>
      </div>
    </div>
  )
}

function Podium({
  ranked,
}: {
  ranked: Array<{ id: string; nickname: string; color: string; score: number }>
}) {
  const medals = ['🥇', '🥈', '🥉']

  return (
    <ul className="w-full flex-col gap-1.5">
      {ranked.map((player, index) => (
        <li
          key={player.id}
          className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
            index === 0 ? 'bg-brand-500/15' : ''
          }`}
        >
          <span className="w-6 text-center text-lg">
            {medals[index] ?? (
              <span className="text-xs text-ink-400">{index + 1}</span>
            )}
          </span>
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: player.color }}
          />
          <span className="flex-1 truncate font-semibold">{player.nickname}</span>
          <span className="font-black tabular-nums">{player.score}</span>
        </li>
      ))}
    </ul>
  )
}
