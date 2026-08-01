'use client'

import { useAppStore, useIsDrawer } from '@/lib/store'
import Canvas from './Canvas'
import CanvasFeed from './CanvasFeed'
import Chat from './Chat'
import PlayerList from './PlayerList'
import Reactions from './Reactions'
import RoundOverlay from './RoundOverlay'
import Toolbar from './Toolbar'
import VoteKickBanner from './VoteKickBanner'
import WordBar from './WordBar'
import WordPicker from './WordPicker'

export default function GameRoom() {
  const snapshot = useAppStore((s) => s.snapshot)
  const status = useAppStore((s) => s.status)
  const isDrawer = useIsDrawer()

  if (!snapshot) return null

  const canDraw = isDrawer && snapshot.phase === 'drawing'
  const showPicker = snapshot.phase === 'word-select'
  const showOverlay =
    snapshot.phase === 'round-end' || snapshot.phase === 'game-end'

  return (
    <main className="mx-auto flex h-dvh w-full max-w-6xl flex-col gap-2 overflow-hidden px-2 py-2 sm:px-5">
      {status !== 'connected' && (
        <div className="flex flex-none justify-end">
          <span className="flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
            <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
            Reconnecting
          </span>
        </div>
      )}

      {snapshot.voteKick && (
        <div className="flex-none">
          <VoteKickBanner />
        </div>
      )}

      <div className="flex-none">
        <WordBar />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:grid lg:gap-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)]">
        <div className="flex min-h-0 shrink-0 flex-col gap-2 lg:order-2 lg:min-h-0 lg:shrink lg:flex-1 lg:gap-3">
          {/* Mobile: always full width (`shrink-0` so the row above can never
              squeeze it) with height derived purely from `aspectRatio` — a
              canvas that got squeezed short would render every client's
              strokes at a different aspect ratio. PlayerList/Chat absorb
              whatever's left. Desktop keeps the original sizing (`lg:` resets)
              since that already had plenty of vertical room to work with. */}
          <div
            className="relative w-full shrink-0 lg:h-auto lg:w-full lg:max-w-none"
            style={{ aspectRatio: '4 / 3' }}
          >
            <Canvas canDraw={canDraw} />
            {showPicker && <WordPicker />}
            {showOverlay && <RoundOverlay />}
            {!isDrawer && snapshot.phase === 'drawing' && <Reactions />}
            <CanvasFeed />
          </div>

          {canDraw && (
            <div className="flex-none">
              <Toolbar />
            </div>
          )}
        </div>

        {/* Side by side on mobile (matches the reference layout); `lg:contents`
            drops this wrapper's own box so PlayerList/Chat become direct grid
            items again at desktop width, landing in their usual columns. */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 lg:contents">
          <PlayerList compact className="lg:order-1" />
          <Chat className="lg:order-3" />
        </div>
      </div>
    </main>
  )
}
