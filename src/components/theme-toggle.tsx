'use client'

import { MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Flips between light and dark. The initial theme follows the system
 * preference (see ThemeProvider defaultTheme="system"); the first click sets an
 * explicit override that next-themes persists. Rendering the icon only after
 * mount avoids an SSR/client hydration mismatch (the resolved theme is unknown
 * on the server); the Button keeps a fixed size so there's no layout shift.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {mounted && (isDark ? <SunIcon /> : <MoonIcon />)}
    </Button>
  )
}
