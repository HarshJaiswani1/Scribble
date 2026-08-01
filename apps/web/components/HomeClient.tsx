'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  NICKNAME_MAX,
  ROOM_CODE_LENGTH,
  nicknameSchema,
  roomCodeSchema,
} from '@scribble/shared'
import { getSocket } from '@/lib/socket'
import { loadNickname, loadSeat, saveNickname, saveSeat } from '@/lib/session'
import { useAppStore } from '@/lib/store'
import { Button, ErrorText, INPUT_CLASS, Label, Panel } from './ui'

type Pending = 'create' | 'join' | null

export default function HomeClient() {
  const router = useRouter()
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const [error, setError] = useState('')
  const status = useAppStore((s) => s.status)

  // localStorage is unavailable during SSR, so hydrate the nickname after mount
  // rather than seeding useState with it.
  useEffect(() => {
    setNickname(loadNickname())

    const socket = getSocket()
    const setStatus = useAppStore.getState().setStatus
    if (socket.connected) setStatus('connected')
    else setStatus('connecting')

    const onConnect = () => setStatus('connected')
    const onDisconnect = () => setStatus('reconnecting')
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.connect()

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  function validateNickname(): string | null {
    const parsed = nicknameSchema.safeParse(nickname)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid nickname')
      return null
    }
    return parsed.data
  }

  function handleCreate() {
    setError('')
    const name = validateNickname()
    if (!name) return

    setPending('create')
    saveNickname(name)

    getSocket().emit('room:create', { nickname: name }, (result) => {
      if (!result.ok) {
        setPending(null)
        setError(result.error)
        return
      }

      const { playerId, token, snapshot } = result.data
      saveSeat(snapshot.code, { playerId, token })
      useAppStore
        .getState()
        .setSeat(playerId, snapshot, getSocket().id ?? null)
      router.push(`/room/${snapshot.code}`)
    })
  }

  function handleJoin() {
    setError('')
    const name = validateNickname()
    if (!name) return

    const parsedCode = roomCodeSchema.safeParse(code)
    if (!parsedCode.success) {
      setError(parsedCode.error.issues[0]?.message ?? 'Invalid room code')
      return
    }
    const roomCode = parsedCode.data

    setPending('join')
    saveNickname(name)

    // Joining here rather than on the room page keeps "no such room" errors on
    // the screen that has the input. The room page handles direct links.
    const seat = loadSeat(roomCode)
    getSocket().emit(
      'room:join',
      { code: roomCode, nickname: name, token: seat?.token },
      (result) => {
        if (!result.ok) {
          setPending(null)
          setError(result.error)
          return
        }

        const { playerId, token, snapshot } = result.data
        saveSeat(snapshot.code, { playerId, token })
        useAppStore
          .getState()
          .setSeat(playerId, snapshot, getSocket().id ?? null)
        router.push(`/room/${snapshot.code}`)
      },
    )
  }

  const busy = pending !== null
  const offline = status !== 'connected'

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-12">
      <header className="text-center">
        <h1 className="text-5xl font-black tracking-tight">
          Scrib<span className="text-brand-400">ble</span>
        </h1>
        <p className="mt-3 text-sm text-ink-400">
          Draw, guess, and out-scribble your friends.
        </p>
      </header>

      <Panel className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <Label>Your nickname</Label>
          <input
            className={INPUT_CLASS}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={NICKNAME_MAX}
            placeholder="Picasso"
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <Button
          onClick={handleCreate}
          disabled={busy || offline}
          className="w-full py-3"
        >
          {pending === 'create' ? 'Creating room…' : 'Create a room'}
        </Button>

        <div className="flex items-center gap-3 text-xs text-ink-400">
          <span className="h-px flex-1 bg-white/10" />
          or join one
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <div className="flex gap-2">
          <input
            className={`${INPUT_CLASS} tabular text-center text-lg font-bold uppercase`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="ABC123"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleJoin()
            }}
          />
          <Button
            variant="secondary"
            onClick={handleJoin}
            disabled={busy || offline || code.length !== ROOM_CODE_LENGTH}
            className="shrink-0"
          >
            {pending === 'join' ? 'Joining…' : 'Join'}
          </Button>
        </div>

        <ErrorText>{error}</ErrorText>

        {offline && (
          <p className="text-center text-xs text-amber-300/80">
            {status === 'reconnecting'
              ? 'Lost the server — reconnecting…'
              : 'Connecting to the server…'}
          </p>
        )}
      </Panel>
    </main>
  )
}
