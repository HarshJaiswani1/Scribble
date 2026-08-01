'use client'

import { useEffect, useRef, useState } from 'react'
import {
  MAX_PLAYERS,
  MAX_ROUNDS,
  MIN_PLAYERS,
  MIN_ROUNDS,
  type SettingsUpdateInput,
} from '@scribble/shared'
import { getSocket } from '@/lib/socket'
import { useAppStore, useIsHost } from '@/lib/store'
import { ErrorText, Label, Panel } from './ui'

const DRAW_TIME_CHOICES = [40, 60, 80, 100, 120, 150, 180] as const

const SELECT_CLASS =
  'w-full appearance-none rounded-xl border border-white/10 bg-ink-850 px-3 py-2.5 text-sm font-semibold text-slate-100 outline-none transition-colors focus:border-brand-500 disabled:opacity-60'

export default function SettingsPanel() {
  const snapshot = useAppStore((s) => s.snapshot)
  const isHost = useIsHost()
  const [error, setError] = useState('')

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [wordDraft, setWordDraft] = useState('')

  const customWords = snapshot?.settings.customWords
  // Only mirror server state into the draft while the field is idle, or typing
  // would be clobbered by our own broadcast echo.
  useEffect(() => {
    if (document.activeElement === textareaRef.current) return
    setWordDraft((customWords ?? []).join('\n'))
  }, [customWords])

  if (!snapshot) return null
  const { settings } = snapshot
  const locked = !isHost || snapshot.phase !== 'lobby'

  function update(patch: SettingsUpdateInput) {
    setError('')
    getSocket().emit('room:settings', patch, (result) => {
      if (!result.ok) setError(result.error)
    })
  }

  function commitWords() {
    const words = wordDraft
      .split(/[\n,]/)
      .map((word) => word.trim())
      .filter(Boolean)
    update({ customWords: words })
  }

  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Game settings</h2>
        {locked && (
          <span className="text-xs text-ink-400">
            {isHost ? 'Locked during play' : 'Host controls these'}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label>Rounds</Label>
          <select
            className={SELECT_CLASS}
            value={settings.rounds}
            disabled={locked}
            onChange={(e) => update({ rounds: Number(e.target.value) })}
          >
            {range(MIN_ROUNDS, MAX_ROUNDS).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Draw time</Label>
          <select
            className={SELECT_CLASS}
            value={settings.drawTimeMs}
            disabled={locked}
            onChange={(e) => update({ drawTimeMs: Number(e.target.value) })}
          >
            {DRAW_TIME_CHOICES.map((seconds) => (
              <option key={seconds} value={seconds * 1000}>
                {seconds}s
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Max players</Label>
          <select
            className={SELECT_CLASS}
            value={settings.maxPlayers}
            disabled={locked}
            onChange={(e) => update({ maxPlayers: Number(e.target.value) })}
          >
            {range(MIN_PLAYERS, MAX_PLAYERS).map((n) => (
              <option key={n} value={n} disabled={n < snapshot.players.length}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <details className="group rounded-xl border border-white/8 bg-ink-850/60">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-400 hover:text-slate-200">
          Custom words
          <span className="ml-2 font-normal normal-case tracking-normal">
            ({settings.customWords.length})
          </span>
        </summary>

        <div className="flex flex-col gap-3 border-t border-white/8 p-4">
          <textarea
            ref={textareaRef}
            className="h-28 w-full resize-y rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-brand-500 disabled:opacity-60"
            placeholder={'one word per line\nor comma separated'}
            value={wordDraft}
            disabled={locked}
            onChange={(e) => setWordDraft(e.target.value)}
            onBlur={commitWords}
          />

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-500"
              checked={settings.useOnlyCustomWords}
              disabled={locked || settings.customWords.length === 0}
              onChange={(e) =>
                update({ useOnlyCustomWords: e.target.checked })
              }
            />
            <span className={settings.customWords.length === 0 ? 'text-ink-400' : ''}>
              Use only my words
            </span>
          </label>
        </div>
      </details>

      <ErrorText>{error}</ErrorText>
    </Panel>
  )
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}
