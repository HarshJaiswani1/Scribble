'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MIN_PLAYERS } from '@scribble/shared'
import { getSocket } from '@/lib/socket'
import { useAppStore, useIsHost } from '@/lib/store'
import Chat from './Chat'
import PlayerList from './PlayerList'
import SettingsPanel from './SettingsPanel'
import { Button, ErrorText, Panel } from './ui'

export default function Lobby({ onLeave }: { onLeave: () => void }) {
  const router = useRouter()
  const snapshot = useAppStore((s) => s.snapshot)
  const status = useAppStore((s) => s.status)
  const isHost = useIsHost()

  const [copied, setCopied] = useState(false)
  const [startError, setStartError] = useState('')

  if (!snapshot) return null

  const connectedCount = snapshot.players.filter((p) => p.connected).length
  const canStart = isHost && connectedCount >= MIN_PLAYERS

  async function copyInvite() {
    const url = `${window.location.origin}/room/${snapshot!.code}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard needs a secure context and permission; fall back to a prompt
      // so the link is still obtainable.
      window.prompt('Copy this invite link:', url)
    }
  }

  function handleStart() {
    setStartError('')
    getSocket().emit('game:start', (result) => {
      if (!result.ok) setStartError(result.error)
    })
  }

  function handleLeave() {
    onLeave()
    router.push('/')
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-black tracking-tight">
            Scrib<span className="text-brand-400">ble</span>
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-ink-400">
              Room
            </span>
            <span className="tabular text-xl font-bold">{snapshot.code}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ConnectionPill status={status} />
          <Button variant="secondary" onClick={copyInvite}>
            {copied ? 'Link copied' : 'Copy invite'}
          </Button>
          <Button variant="ghost" onClick={handleLeave}>
            Leave
          </Button>
        </div>
      </header>

      <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <PlayerList />

        <div className="flex flex-col gap-5">
          <SettingsPanel />

          <Panel className="flex flex-col gap-3 p-5">
            {isHost ? (
              <>
                <Button
                  onClick={handleStart}
                  disabled={!canStart}
                  className="w-full py-3 text-base"
                >
                  Start game
                </Button>
                {!canStart && (
                  <p className="text-center text-xs text-ink-400">
                    Waiting for at least {MIN_PLAYERS} players —{' '}
                    {connectedCount} here so far.
                  </p>
                )}
                <ErrorText>{startError}</ErrorText>
              </>
            ) : (
              <p className="text-center text-sm text-ink-400">
                Waiting for the host to start the game…
              </p>
            )}
          </Panel>

          <Chat className="max-h-72" />
        </div>
      </div>
    </main>
  )
}

function ConnectionPill({ status }: { status: string }) {
  if (status === 'connected') {
    return (
      <span className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
        <span className="size-1.5 rounded-full bg-emerald-400" />
        Live
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
      <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
      Reconnecting
    </span>
  )
}
