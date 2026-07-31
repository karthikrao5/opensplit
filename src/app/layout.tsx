import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

// Self-hosted at build time by next/font. Bound to the `--font-sans` variable
// that globals.css already feeds into Tailwind's font-sans (and font-heading).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = { title: 'OpenSplit' }

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div className="mx-auto max-w-2xl px-4 py-8">{children}</div>
      </body>
    </html>
  )
}
