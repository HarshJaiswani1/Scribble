'use client'

import { useEffect, useState } from 'react'
import { getSocket } from '@/lib/socket'
import { useAppStore } from '@/lib/store'
import { useCountdown } from '@/lib/useCountdown'
import { Button } from './ui'

/**
 * Live for any active vote, in any phase including the lobby. Deliberately
 * not built on `Panel` — it needs its own border/background colour, and
 * fighting Panel's base classes for that is a losing battle against Tailwind's
 * generation-order cascade.
 */
export default function VoteKickBanner() {
  const voteKick = useAppStore((s) => s.snapshot?.voteKick)
  const players = useAppStore((s) => s.snapshot?.players)
  const selfId = useAppStore((s) => s.selfId)
  const offsetMs = useAppStore((s) => s.clockOffsetMs)
  const [voted, setVoted] = useState(false)

  const remainingMs = useCountdown(voteKick?.endsAt ?? null, offsetMs)

  // A fresh vote (even against the same target) gets a fresh ballot.
  useEffect(() => {
    setVoted(false)
  }, [voteKick?.targetId, voteKick?.endsAt])

  if (!voteKick) return null

  const target = players?.find((p) => p.id === voteKick.targetId)
  const isTarget = selfId === voteKick.targetId
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000))

  function castVote() {
    setVoted(true)
    getSocket().emit('player:vote-kick-cast', (result) => {
      if (!result.ok) setVoted(false)
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 backdrop-blur-sm">
      <p className="text-sm text-amber-100">
        <span className="font-semibold">Vote to kick</span>{' '}
        {target?.nickname ?? 'a player'} — {voteKick.votes}/{voteKick.required}{' '}
        votes · {seconds}s left
      </p>

      {isTarget ? (
        <span className="text-xs text-amber-200/70">
          This vote is about you
        </span>
      ) : (
        <Button variant={voted ? 'secondary' : 'primary'} onClick={castVote} disabled={voted}>
          {voted ? 'Voted' : 'Vote yes'}
        </Button>
      )}
    </div>
  )
}
