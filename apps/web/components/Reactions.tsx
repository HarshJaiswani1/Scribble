'use client'

import { useEffect, useState } from 'react'
import { getSocket } from '@/lib/socket'
import { useAppStore } from '@/lib/store'

/** Floating like/dislike buttons over the canvas. Only rendered for non-drawers mid-drawing. */
export default function Reactions() {
  const drawerId = useAppStore((s) => s.snapshot?.drawerId)
  const [sent, setSent] = useState<'like' | 'dislike' | null>(null)

  // A new turn is a new drawing — the ballot resets.
  useEffect(() => {
    setSent(null)
  }, [drawerId])

  function react(reaction: 'like' | 'dislike') {
    if (sent) return
    setSent(reaction)
    getSocket().emit('draw:react', { reaction }, (result) => {
      if (!result.ok) setSent(null)
    })
  }

  return (
    <div className="absolute right-2 top-2 flex gap-1.5">
      <ReactionButton
        active={sent === 'like'}
        disabled={sent !== null}
        onClick={() => react('like')}
        label="Like this drawing"
        activeClass="border-emerald-400/40 bg-emerald-500/25"
      >
        👍
      </ReactionButton>
      <ReactionButton
        active={sent === 'dislike'}
        disabled={sent !== null}
        onClick={() => react('dislike')}
        label="Dislike this drawing"
        activeClass="border-rose-400/40 bg-rose-500/25"
      >
        👎
      </ReactionButton>
    </div>
  )
}

function ReactionButton({
  active,
  disabled,
  onClick,
  label,
  activeClass,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  label: string
  activeClass: string
  children: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`grid size-9 place-items-center rounded-full border text-base backdrop-blur-sm transition-colors disabled:cursor-not-allowed ${
        active
          ? activeClass
          : 'border-white/10 bg-ink-900/70 hover:bg-white/10'
      } ${disabled && !active ? 'opacity-40' : ''}`}
    >
      {children}
    </button>
  )
}
