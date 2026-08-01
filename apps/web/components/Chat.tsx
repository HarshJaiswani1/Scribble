'use client'

import { useEffect, useRef, useState } from 'react'
import { CHAT_MAX_LENGTH, type FeedMessage } from '@scribble/shared'
import { getSocket } from '@/lib/socket'
import { useAppStore, useIsDrawer, useSelf } from '@/lib/store'
import { Panel } from './ui'

export default function Chat({ className = '' }: { className?: string }) {
  const messages = useAppStore((s) => s.messages)
  const phase = useAppStore((s) => s.snapshot?.phase)
  const isDrawer = useIsDrawer()
  const self = useSelf()

  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // Only follow the tail if the reader is already there — yanking them down
  // mid-scroll is worse than missing a line.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return

    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    if (distanceFromBottom < 80) {
      endRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [messages])

  function send() {
    const text = draft.trim()
    if (!text) return
    getSocket().emit('chat:message', { text })
    setDraft('')
  }

  const placeholder = isDrawer
    ? "You're drawing — no spoilers!"
    : phase === 'drawing' && self?.hasGuessed
      ? 'You got it — chat with the others'
      : phase === 'drawing'
        ? 'Type your guess…'
        : 'Say something…'

  return (
    <Panel className={`flex min-h-0 flex-col overflow-hidden ${className}`}>
      <h2 className="border-b border-white/8 px-4 py-2.5 text-sm font-bold">
        Chat
      </h2>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="text-xs text-ink-400">
            Guesses and chatter show up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {messages.map((message) => (
              <li key={message.id} className="text-sm leading-snug">
                <Line message={message} />
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-white/8 p-2">
        <input
          className="w-full rounded-xl border border-white/10 bg-ink-850 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-400/60 focus:border-brand-500"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={placeholder}
          autoComplete="off"
        />
      </div>
    </Panel>
  )
}

function Line({ message }: { message: FeedMessage }) {
  switch (message.kind) {
    case 'chat':
      return (
        <span>
          <span className="font-semibold" style={{ color: message.color ?? undefined }}>
            {message.nickname}
          </span>
          <span className="text-ink-400">: </span>
          <span className="text-slate-200">{message.text}</span>
        </span>
      )

    case 'correct':
      return (
        <span className="font-semibold text-emerald-300">✓ {message.text}</span>
      )

    case 'join':
      return <span className="text-xs text-emerald-300/80">{message.text}</span>

    case 'leave':
      return <span className="text-xs text-rose-300/80">{message.text}</span>

    case 'like':
      return <span className="text-xs text-emerald-300/80">👍 {message.text}</span>

    case 'dislike':
      return <span className="text-xs text-rose-300/70">👎 {message.text}</span>

    // Both of these are sent to one player only, never the room.
    case 'close':
      return <span className="text-amber-300">{message.text}</span>

    case 'warning':
      return (
        <span className="font-semibold text-amber-300">⚠ {message.text}</span>
      )

    default:
      return <span className="text-xs text-ink-400">{message.text}</span>
  }
}
