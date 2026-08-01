'use client'

import { getSocket } from '@/lib/socket'
import { useAppStore, useIsHost } from '@/lib/store'
import { Panel } from './ui'

export default function PlayerList({ compact = false }: { compact?: boolean }) {
  const snapshot = useAppStore((s) => s.snapshot)
  const selfId = useAppStore((s) => s.selfId)
  const isHost = useIsHost()

  if (!snapshot) return null

  const inGame = snapshot.phase !== 'lobby'
  // Ranked during play so the leader is obvious; join order in the lobby so
  // players can see the turn order they'll actually get.
  const players = inGame
    ? [...snapshot.players].sort((a, b) => b.score - a.score)
    : snapshot.players

  function kick(playerId: string) {
    getSocket().emit('player:kick', { playerId }, () => {
      // The authoritative roster arrives via room:state either way, so a
      // failure here needs no local rollback.
    })
  }

  return (
    <Panel className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <h2 className="text-sm font-bold">Players</h2>
        <span className="text-xs text-ink-400">
          {snapshot.players.length} / {snapshot.settings.maxPlayers}
        </span>
      </div>

      <ul className="flex flex-col divide-y divide-white/5">
        {players.map((player, index) => (
          <li
            key={player.id}
            className={`group flex items-center gap-2.5 px-4 py-2.5 ${
              player.connected ? '' : 'opacity-45'
            } ${player.hasGuessed ? 'bg-emerald-500/8' : ''}`}
          >
            <span className="w-4 text-xs font-semibold text-ink-400">
              {index + 1}
            </span>

            <span
              aria-hidden
              className="size-7 shrink-0 rounded-full border-2 border-white/10"
              style={{ backgroundColor: player.color }}
            />

            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                <span className="truncate">{player.nickname}</span>
                {player.id === selfId && (
                  <span className="text-xs font-normal text-brand-300">you</span>
                )}
                {player.isDrawing && <span title="Drawing">✏️</span>}
                {player.hasGuessed && (
                  <span title="Guessed it" className="text-emerald-300">
                    ✓
                  </span>
                )}
              </span>
              <span className="text-xs text-ink-400">
                {!player.connected
                  ? 'Disconnected'
                  : inGame
                    ? `${player.score} pts`
                    : player.isHost
                      ? 'Host'
                      : 'Ready'}
              </span>
            </div>

            {isHost && player.id !== selfId && !compact && (
              <button
                onClick={() => kick(player.id)}
                aria-label={`Remove ${player.nickname}`}
                title={`Remove ${player.nickname}`}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-400 opacity-0 transition hover:bg-rose-500/15 hover:text-rose-300 focus-visible:opacity-100 group-hover:opacity-100"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
