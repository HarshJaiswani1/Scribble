'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { NICKNAME_MAX, nicknameSchema } from '@scribble/shared'
import { useRoom } from '@/lib/useRoom'
import { useAppStore } from '@/lib/store'
import GameRoom from './GameRoom'
import Lobby from './Lobby'
import { Button, ErrorText, INPUT_CLASS, Label, Panel } from './ui'

export default function RoomClient({ code }: { code: string }) {
  const { joinState, submitNickname, retry, leave } = useRoom(code)
  const snapshot = useAppStore((s) => s.snapshot)

  if (joinState.kind === 'need-nickname') {
    return <NicknameGate code={code} onSubmit={submitNickname} />
  }

  if (joinState.kind === 'error') {
    return <RoomError message={joinState.message} onRetry={retry} />
  }

  if (joinState.kind !== 'joined' || !snapshot) {
    return <Centered>Joining room {code}…</Centered>
  }

  // The phase is the single switch between the two screens, so a mid-game
  // joiner and a reconnecting player land in the right place automatically.
  if (snapshot.phase === 'lobby') return <Lobby onLeave={leave} />
  return <GameRoom onLeave={leave} />
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <p className="animate-pulse text-sm text-ink-400">{children}</p>
    </main>
  )
}

function NicknameGate({
  code,
  onSubmit,
}: {
  code: string
  onSubmit: (nickname: string) => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  function submit() {
    const parsed = nicknameSchema.safeParse(value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid nickname')
      return
    }
    setError('')
    onSubmit(parsed.data)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-5">
      <header className="text-center">
        <p className="text-xs uppercase tracking-wider text-ink-400">
          You&rsquo;re invited to
        </p>
        <p className="tabular mt-1 text-4xl font-black">{code}</p>
      </header>

      <Panel className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-2">
          <Label>Pick a nickname</Label>
          <input
            className={INPUT_CLASS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={NICKNAME_MAX}
            placeholder="Picasso"
            autoComplete="off"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </div>
        <Button onClick={submit} className="w-full py-3">
          Join room
        </Button>
        <ErrorText>{error}</ErrorText>
      </Panel>
    </main>
  )
}

function RoomError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const router = useRouter()

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-5">
      <Panel className="flex flex-col items-center gap-5 p-8 text-center">
        <p className="text-lg font-semibold">{message}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push('/')}>
            Back to the start
          </Button>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      </Panel>
    </main>
  )
}
