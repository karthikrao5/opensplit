'use client'

import { Trash2Icon } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { deleteTransaction } from '@/lib/actions/transactions'
import { formatMoney } from '@/lib/money'

export type SettlementRow = {
  id: string
  fromName: string
  toName: string
  amountMinor: number
  occurredAt: Date
}

/** The recorded settlement payments for a group (shown on the Settle tab). */
export function SettlementList({
  groupId,
  currency,
  settlements,
}: {
  groupId: string
  currency: string
  settlements: SettlementRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (settlements.length === 0) return null

  function remove(id: string) {
    setError(null)
    startTransition(async () => {
      const result = await deleteTransaction({ groupId, transactionId: id })
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Payments</h2>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="flex flex-col gap-2">
        {settlements.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-lg border p-3 text-sm"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">
                {s.fromName} paid {s.toName}
              </span>
              <span
                className="text-xs text-muted-foreground"
                suppressHydrationWarning
              >
                {mounted
                  ? s.occurredAt.toLocaleString(undefined, {
                      dateStyle: 'medium',
                    })
                  : s.occurredAt.toISOString().slice(0, 10)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {formatMoney(s.amountMinor, currency)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-destructive"
              aria-label="Delete payment"
              disabled={pending}
              onClick={() => remove(s.id)}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
