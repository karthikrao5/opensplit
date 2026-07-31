'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { deleteTransaction } from '@/lib/actions/transactions'
import { formatMoney } from '@/lib/money'

export type TransactionRow = {
  id: string
  kind: 'EXPENSE' | 'SETTLEMENT'
  description: string
  amountMinor: number
  payerName: string
  recipientName: string | null
  splitCount: number
  occurredAt: string
}

export function TransactionList({
  groupId,
  currency,
  transactions,
}: {
  groupId: string
  currency: string
  transactions: TransactionRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (transactions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No transactions yet. Add the first one.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="flex flex-col gap-3">
        {transactions.map((tx) => (
          <li key={tx.id} className="flex items-start gap-3 text-sm">
            <span className="w-16 shrink-0 text-muted-foreground">
              {tx.occurredAt}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="font-medium break-words">
                {tx.kind === 'SETTLEMENT'
                  ? `${tx.payerName} paid ${tx.recipientName}`
                  : tx.description}
              </span>
              <span className="text-muted-foreground">
                {tx.kind === 'SETTLEMENT'
                  ? formatMoney(tx.amountMinor, currency)
                  : `${tx.payerName} paid ${formatMoney(tx.amountMinor, currency)} · split ${tx.splitCount} ${tx.splitCount === 1 ? 'way' : 'ways'}`}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto shrink-0 text-destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null)
                  const result = await deleteTransaction({
                    groupId,
                    transactionId: tx.id,
                  })
                  if (!result.ok) setError(result.error)
                })
              }
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
