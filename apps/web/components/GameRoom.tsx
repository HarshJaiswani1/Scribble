'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getSocket } from '@/lib/socket'
import { useAppStore, useIsDrawer, useIsHost } from '@/lib/store'
import Canvas from './Canvas'
import Chat from './Chat'
import PlayerList from './PlayerList'
import RoundOverlay from './RoundOverlay'
import Toolbar from './Toolbar'
import WordBar from './WordBar'
import WordPicker from './WordPicker'
import { Button } from './ui'

export default function GameRoom({ onLeave }: { onLeave: () => void }) {
  const router = useRouter()
  const snapshot = useAppStore((s) => s.snapshot)
  const status = useAppStore((s) => s.status)
  const isDrawer = useIsDrawer()
  const isHost = useIsHost()
  const [confirmEnd, setConfirmEnd] = useState(false)

  if (!snapshot) return null

  const canDraw = isDrawer && snapshot.phase === 'drawing'
  const showPicker = snapshot.phase === 'word-select'
  const showOverlay =
    snapshot.phase === 'round-end' || snapshot.phase === 'game-end'

  function handleLeave() {
    onLeave()
    router.push('/')
  }

  function endGame() {
    getSocket().emit('game:abort', () => setConfirmEnd(false))
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-3 px-3 py-4 sm:px-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-black tracking-tight">
            Scrib<span className="text-brand-400">ble</span>
          </h1>
          <span className="tabular text-sm text-ink-400">{snapshot.code}</span>
        </div>

        <div className="flex items-center gap-2">
          {status !== 'connected' && (
            <span className="flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
              Reconnecting
            </span>
          )}

          {isHost &&
            (confirmEnd ? (
              <>
                <Button variant="danger" onClick={endGame}>
                  End game?
                </Button>
                <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmEnd(true)}>
                End game
              </Button>
            ))}

          <Button variant="ghost" onClick={handleLeave}>
            Leave
          </Button>
        </div>
      </header>

      <WordBar />

      <div className="grid flex-1 gap-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)]">
        <PlayerList compact />

        <div className="flex flex-col gap-3">
          <div className="relative">
            <Canvas canDraw={canDraw} />
            {showPicker && <WordPicker />}
            {showOverlay && <RoundOverlay />}
          </div>

          {canDraw && <Toolbar />}
        </div>

        <Chat className="max-h-[32rem] lg:max-h-none" />
      </div>
    </main>
  )
}
