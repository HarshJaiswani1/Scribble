import { notFound } from 'next/navigation'
import { ROOM_CODE_LENGTH } from '@scribble/shared'
import RoomClient from '@/components/RoomClient'

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const normalized = decodeURIComponent(code).toUpperCase()

  // Reject malformed codes before opening a socket — saves a pointless join.
  if (!/^[A-Z0-9]+$/.test(normalized) || normalized.length !== ROOM_CODE_LENGTH) {
    notFound()
  }

  return <RoomClient code={normalized} />
}
