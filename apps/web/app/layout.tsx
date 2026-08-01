import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Scribble',
  description: 'Draw, guess, and out-scribble your friends.',
}

export const viewport: Viewport = {
  themeColor: '#080c18',
  // The drawing canvas in M2 relies on pointer events, which double-tap zoom
  // interferes with badly.
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Without this, focusing the chat input pans the whole page up behind the
  // on-screen keyboard instead of shrinking `dvh` — pushing the canvas out of
  // view. This makes the keyboard shrink the layout viewport instead, so the
  // `shrink-0` canvas stays put and only the flexible chat/player area gives
  // up space.
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
