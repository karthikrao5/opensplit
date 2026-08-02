'use client'

import { ArrowLeftRightIcon, ReceiptIcon } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import {
  AddTransactionDialog,
  type MemberOption,
} from '@/components/add-transaction-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { deleteTransaction } from '@/lib/actions/transactions'
import { formatMoney } from '@/lib/money'

export type TransactionRow = {
  id: string
  kind: 'EXPENSE' | 'SETTLEMENT'
  description: string
  amountMinor: number
  payerMemberId: string
  includedMemberIds: string[]
  splitType: 'EVEN' | 'PERCENTAGE' | 'EXACT'
  percentages: { memberId: string; percent: number }[]
  amounts: { memberId: string; amountMinor: number }[]
  payerName: string
  recipientName: string | null
  splitCount: number
  occurredAt: Date
}

/**
 * The DB value is a UTC instant. Local time depends on the viewer's timezone,
 * which is only known on the client — so render the timezone-stable UTC date
 * on the server / first paint and switch to the viewer's local date-time once
 * mounted, avoiding a hydration mismatch.
 */
function formatOccurredAt(date: Date, mounted: boolean): string {
  if (!mounted) return date.toISOString().slice(0, 10)
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
  })
}

export function TransactionList({
  groupId,
  currency,
  members,
  defaultPayerId,
  currentMemberId,
  transactions,
}: {
  groupId: string
  currency: string
  members: MemberOption[]
  defaultPayerId: string
  currentMemberId: string
  transactions: TransactionRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editingTx, setEditingTx] = useState<TransactionRow | null>(null)
  const [deletingTx, setDeletingTx] = useState<TransactionRow | null>(null)
  const [onlyMine, setOnlyMine] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  function confirmDelete() {
    if (!deletingTx) return
    const transactionId = deletingTx.id
    setError(null)
    startTransition(async () => {
      const result = await deleteTransaction({ groupId, transactionId })
      if (!result.ok) return setError(result.error)
      setDeletingTx(null)
    })
  }

  if (transactions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No transactions yet. Add the first one.
      </p>
    )
  }

  // "Mine" = the current user is the payer or one of the split participants.
  const visible = onlyMine
    ? transactions.filter(
        (tx) =>
          tx.payerMemberId === currentMemberId ||
          tx.includedMemberIds.includes(currentMemberId),
      )
    : transactions

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 self-start text-sm text-muted-foreground">
        <Checkbox
          checked={onlyMine}
          onCheckedChange={(v) => setOnlyMine(v === true)}
        />
        Only my transactions
      </label>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You&apos;re not part of any transactions yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((tx) => (
          <li
            key={tx.id}
            className={`flex items-start gap-3 rounded-lg border p-3 text-sm${
              tx.kind === 'EXPENSE'
                ? ' cursor-pointer transition-colors hover:bg-accent'
                : ''
            }`}
            role={tx.kind === 'EXPENSE' ? 'button' : undefined}
            tabIndex={tx.kind === 'EXPENSE' ? 0 : undefined}
            onClick={
              tx.kind === 'EXPENSE' ? () => setEditingTx(tx) : undefined
            }
            onKeyDown={
              tx.kind === 'EXPENSE'
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setEditingTx(tx)
                    }
                  }
                : undefined
            }
          >
            <div className="flex shrink-0 items-center gap-3 self-center">
              {tx.kind === 'SETTLEMENT' ? (
                <ArrowLeftRightIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-label="Settlement"
                />
              ) : (
                <ReceiptIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-label="Expense"
                />
              )}
              <span
                className="w-24 text-xs text-muted-foreground"
                suppressHydrationWarning
              >
                {formatOccurredAt(tx.occurredAt, mounted)}
              </span>
            </div>
            {tx.kind === 'EXPENSE' ? (
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium break-words">
                  {tx.description}
                </span>
                <span className="text-muted-foreground">
                  {`${tx.payerName} paid ${formatMoney(tx.amountMinor, currency)} · ${
                    tx.splitType === 'PERCENTAGE'
                      ? 'split by %'
                      : tx.splitType === 'EXACT'
                        ? 'split by amount'
                        : `split ${tx.splitCount} ${tx.splitCount === 1 ? 'way' : 'ways'}`
                  }`}
                </span>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col">
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
              className="ml-auto shrink-0 self-center text-destructive"
              disabled={pending}
              onClick={(e) => {
                e.stopPropagation()
                setError(null)
                setDeletingTx(tx)
              }}
            >
              Delete
            </Button>
            </li>
          ))}
        </ul>
      )}

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
            // The date input wants YYYY-MM-DD; keep the UTC calendar date the
            // expense was originally saved with (not a timezone-shifted one).
            occurredAt: editingTx.occurredAt.toISOString().slice(0, 10),
            splitType: editingTx.splitType,
            percentages: editingTx.percentages,
            amounts: editingTx.amounts,
          }}
          onClose={() => setEditingTx(null)}
        />
      )}

      <Dialog
        open={deletingTx !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingTx(null)
            setError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete transaction?</DialogTitle>
            <DialogDescription>
              {deletingTx
                ? `“${
                    deletingTx.kind === 'SETTLEMENT'
                      ? `${deletingTx.payerName} paid ${deletingTx.recipientName}`
                      : deletingTx.description
                  }” will be permanently removed. This can’t be undone.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setDeletingTx(null)
                setError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={confirmDelete}
            >
              {pending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
