import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'OpenSplit' }

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div className="mx-auto max-w-2xl px-4 py-8">{children}</div>
      </body>
    </html>
  )
}
