import Link from 'next/link'
import { ROOM_CODE_LENGTH } from '@scribble/shared'

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="text-3xl font-black">That page doesn&rsquo;t exist</h1>
      <p className="text-sm text-ink-400">
        Room codes are {ROOM_CODE_LENGTH} characters — check the link and try
        again.
      </p>
      <Link
        href="/"
        className="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-400"
      >
        Back to the start
      </Link>
    </main>
  )
}
