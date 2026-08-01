'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getSocket } from '@/lib/socket'
import { useAppStore, useIsDrawer, useIsHost } from '@/lib/store'
import Canvas from './Canvas'
import Chat from './Chat'
import PlayerList from './PlayerList'
import Reactions from './Reactions'
import RoundOverlay from './RoundOverlay'
import Toolbar from './Toolbar'
import VoteKickBanner from './VoteKickBanner'
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

      {snapshot.voteKick && <VoteKickBanner />}

      <WordBar />

      <div className="flex flex-1 flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)]">
        <div className="flex flex-col gap-3 lg:order-2">
          <div className="relative">
            <Canvas canDraw={canDraw} />
            {showPicker && <WordPicker />}
            {showOverlay && <RoundOverlay />}
            {!isDrawer && snapshot.phase === 'drawing' && <Reactions />}
          </div>

          {canDraw && <Toolbar />}
        </div>

        {/* Side by side on mobile (matches the reference layout); `lg:contents`
            drops this wrapper's own box so PlayerList/Chat become direct grid
            items again at desktop width, landing in their usual columns. */}
        <div className="grid grid-cols-2 gap-3 lg:contents">
          <PlayerList compact className="max-h-80 lg:order-1 lg:max-h-none" />
          <Chat className="max-h-80 lg:order-3 lg:max-h-none" />
        </div>
      </div>
    </main>
  )
}
