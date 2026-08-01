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
