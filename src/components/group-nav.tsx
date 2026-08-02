'use client'

import {
  ArrowLeftRightIcon,
  ReceiptIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/** Fixed bottom tab bar. Each tab is a real route; the active one is derived
 * from the current pathname. */
export function GroupNav({ groupId }: { groupId: string }) {
  const pathname = usePathname()
  const base = `/groups/${groupId}`
  const tabs: { href: string; label: string; Icon: LucideIcon }[] = [
    { href: base, label: 'Transactions', Icon: ReceiptIcon },
    { href: `${base}/settle`, label: 'Settle up', Icon: ArrowLeftRightIcon },
    { href: `${base}/members`, label: 'Members', Icon: UsersIcon },
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background">
      <div className="mx-auto flex max-w-2xl">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs transition-colors',
                active
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
