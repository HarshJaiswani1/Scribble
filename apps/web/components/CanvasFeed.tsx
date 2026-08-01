'use client'

import { useEffect, useState } from 'react'
import type { FeedMessage } from '@scribble/shared'
import { useAppStore } from '@/lib/store'
import { Line } from './Chat'

const VISIBLE_MS = 2000

/** Flashes the latest chat/guess line over the canvas's bottom-right corner, then fades it out. */
export default function CanvasFeed() {
  const messages = useAppStore((s) => s.messages)
  const latest = messages[messages.length - 1] ?? null
  const [visible, setVisible] = useState<FeedMessage | null>(null)

  useEffect(() => {
    if (!latest) return
    setVisible(latest)
    const timer = window.setTimeout(() => setVisible(null), VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [latest])

  if (!visible) return null

  return (
    <div className="pointer-events-none absolute bottom-2 right-2 z-10 max-w-[70%]">
      <div className="truncate rounded-full bg-ink-950/70 px-2.5 py-1 text-xs leading-snug backdrop-blur-sm">
        <Line message={visible} />
      </div>
    </div>
  )
}
