'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSocket } from './socket'
import { clearSeat, loadNickname, loadSeat, saveNickname, saveSeat } from './session'
import { board } from './drawing'
import { useAppStore } from './store'

export type JoinState =
  | { kind: 'connecting' }
  | { kind: 'need-nickname' }
  | { kind: 'joining' }
  | { kind: 'joined' }
  | { kind: 'error'; message: string }

/**
 * Owns the room lifecycle for one room page: socket listeners, the join
 * handshake, and re-joining after a reconnect.
 */
export function useRoom(code: string) {
  const [joinState, setJoinState] = useState<JoinState>({ kind: 'connecting' })

  /**
   * Guards against two joins racing on the same socket. React StrictMode
   * double-invokes effects in development, and the first join's ack (which
   * carries the token) may not have landed before the second fires — without
   * this the server would hand out a second seat and a duplicate nickname.
   */
  const joinInFlight = useRef(false)

  const attemptJoin = useCallback(
    (explicitNickname?: string) => {
      const socket = getSocket()
      if (!socket.connected || joinInFlight.current) return

      const seat = loadSeat(code)
      const nickname = explicitNickname ?? loadNickname()

      // No nickname and no seat to reclaim means this is a cold visit from a
      // shared link — we have to ask before we can join.
      if (!nickname && !seat) {
        setJoinState({ kind: 'need-nickname' })
        return
      }

      joinInFlight.current = true
      setJoinState({ kind: 'joining' })

      socket.emit(
        'room:join',
        {
          code,
          // Ignored by the server when the token matches a seat, but the
          // schema still requires a non-empty value.
          nickname: nickname || 'Player',
          token: seat?.token,
        },
        (result) => {
          joinInFlight.current = false

          if (!result.ok) {
            setJoinState({ kind: 'error', message: result.error })
            return
          }

          const { playerId, token, snapshot } = result.data
          saveSeat(code, { playerId, token })
          if (nickname) saveNickname(nickname)
          useAppStore.getState().setSeat(playerId, snapshot, socket.id ?? null)
          setJoinState({ kind: 'joined' })
        },
      )
    },
    [code],
  )

  /**
   * Joins unless this socket connection already holds a seat in this room.
   * Comparing against the stored socket id is what separates "we just created
   * this room a navigation ago" from "our socket dropped and came back".
   */
  const syncJoin = useCallback(() => {
    const socket = getSocket()
    if (!socket.connected) return

    const state = useAppStore.getState()
    if (state.seatSocketId === socket.id && state.snapshot?.code === code) {
      setJoinState({ kind: 'joined' })
      return
    }

    attemptJoin()
  }, [attemptJoin, code])

  useEffect(() => {
    const socket = getSocket()
    const store = useAppStore.getState()

    function measureClockOffset() {
      const sentAt = Date.now()
      socket.emit('ping:time', (result) => {
        if (!result.ok) return
        const now = Date.now()
        // Assume a symmetric round trip and credit half of it to the reply.
        const oneWay = (now - sentAt) / 2
        useAppStore
          .getState()
          .setClockOffset(result.data.serverTime + oneWay - now)
      })
    }

    function onConnect() {
      useAppStore.getState().setStatus('connected')
      measureClockOffset()
      syncJoin()
    }

    function onDisconnect() {
      useAppStore.getState().setStatus('reconnecting')
      joinInFlight.current = false
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('room:state', (snapshot) => {
      useAppStore.getState().setSnapshot(snapshot)
    })
    socket.on('feed:message', (message) => {
      useAppStore.getState().addMessage(message)
    })
    socket.on('room:closed', (reason) => {
      // The seat token is deliberately left in place: another tab may share it,
      // and the server treats an unmatched token as a plain first-time join.
      board.clear()
      useAppStore.getState().reset()
      useAppStore.getState().setClosedReason(reason)
      setJoinState({ kind: 'error', message: reason })
    })

    socket.on('word:options', (offer) => {
      useAppStore.getState().setWordOffer(offer)
    })
    socket.on('word:assigned', ({ word }) => {
      useAppStore.getState().setWord(word)
      useAppStore.getState().setWordOffer(null)
    })

    // Canvas events bypass React state entirely — see lib/drawing.ts.
    socket.on('draw:begin', (stroke) => board.begin(stroke))
    socket.on('draw:append', ({ id, points }) => board.append(id, points))
    socket.on('draw:end', ({ id }) => board.end(id))
    socket.on('draw:undo', ({ id }) => board.undo(id))
    socket.on('draw:clear', () => board.clear())
    socket.on('canvas:sync', ({ strokes }) => board.sync(strokes))

    if (socket.connected) {
      store.setStatus('connected')
      measureClockOffset()
      syncJoin()
    } else {
      store.setStatus('connecting')
      socket.connect()
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('room:state')
      socket.off('feed:message')
      socket.off('room:closed')
      socket.off('word:options')
      socket.off('word:assigned')
      socket.off('draw:begin')
      socket.off('draw:append')
      socket.off('draw:end')
      socket.off('draw:undo')
      socket.off('draw:clear')
      socket.off('canvas:sync')
    }
  }, [syncJoin])

  const submitNickname = useCallback(
    (nickname: string) => {
      saveNickname(nickname)
      attemptJoin(nickname)
    },
    [attemptJoin],
  )

  const retry = useCallback(() => {
    useAppStore.getState().reset()
    setJoinState({ kind: 'connecting' })
    syncJoin()
  }, [syncJoin])

  const leave = useCallback(() => {
    getSocket().emit('room:leave')
    clearSeat(code)
    board.clear()
    useAppStore.getState().reset()
  }, [code])

  return { joinState, submitNickname, retry, leave }
}
