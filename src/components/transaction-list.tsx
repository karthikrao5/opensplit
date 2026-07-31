'use client'

import { useState, useTransition } from 'react'
import {
  AddTransactionDialog,
  type MemberOption,
} from '@/components/add-transaction-dialog'
import { Button } from '@/components/ui/button'
import { deleteTransaction } from '@/lib/actions/transactions'
import { formatMoney } from '@/lib/money'

export type TransactionRow = {
  id: string
  kind: 'EXPENSE' | 'SETTLEMENT'
  description: string
  amountMinor: number
  payerMemberId: string
  includedMemberIds: string[]
  splitType: 'EVEN' | 'PERCENTAGE'
  percentages: { memberId: string; percent: number }[]
  payerName: string
  recipientName: string | null
  splitCount: number
  occurredAt: string
}

export function TransactionList({
  groupId,
  currency,
  members,
  defaultPayerId,
  transactions,
}: {
  groupId: string
  currency: string
  members: MemberOption[]
  defaultPayerId: string
  transactions: TransactionRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editingTx, setEditingTx] = useState<TransactionRow | null>(null)

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
            {tx.kind === 'EXPENSE' ? (
              <button
                type="button"
                onClick={() => setEditingTx(tx)}
                className="flex min-w-0 flex-1 flex-col rounded-md text-left transition-colors hover:bg-accent"
              >
                <span className="font-medium break-words">
                  {tx.description}
                </span>
                <span className="text-muted-foreground">
                  {tx.splitType === 'PERCENTAGE'
                    ? `${tx.payerName} paid ${formatMoney(tx.amountMinor, currency)} · split by %`
                    : `${tx.payerName} paid ${formatMoney(tx.amountMinor, currency)} · split ${tx.splitCount} ${tx.splitCount === 1 ? 'way' : 'ways'}`}
                </span>
              </button>
            ) : (
              <div className="flex min-w-0 flex-col">
                <span className="font-medium break-words">
                  {`${tx.payerName} paid ${tx.recipientName}`}
                </span>
                <span className="text-muted-foreground">
                  {formatMoney(tx.amountMinor, currency)}
                </span>
              </div>
            )}
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

      {editingTx && (
        <AddTransactionDialog
          key={editingTx.id}
          groupId={groupId}
          currency={currency}
          members={members}
          defaultPayerId={defaultPayerId}
          editing={{
            transactionId: editingTx.id,
            description: editingTx.description,
            amountMinor: editingTx.amountMinor,
            payerMemberId: editingTx.payerMemberId,
            includedMemberIds: editingTx.includedMemberIds,
            occurredAt: editingTx.occurredAt,
            splitType: editingTx.splitType,
            percentages: editingTx.percentages,
          }}
          onClose={() => setEditingTx(null)}
        />
      )}
    </div>
  )
}
