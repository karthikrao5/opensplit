'use client'

import { useState } from 'react'
import type { MemberOption } from '@/components/add-transaction-dialog'
import { SettlementDialog } from '@/components/settlement-dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { Transfer } from '@/lib/balances'
import { formatMoney } from '@/lib/money'

export function BalanceSummary({
  groupId,
  currency,
  members,
  balances,
  transfers,
  yourMemberId,
}: {
  groupId: string
  currency: string
  members: MemberOption[]
  balances: { memberId: string; net: number }[]
  transfers: Transfer[]
  yourMemberId: string
}) {
  const [prefill, setPrefill] = useState<Transfer | null>(null)
  const [open, setOpen] = useState(false)
  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? 'Unknown'

  const yours = balances.find((b) => b.memberId === yourMemberId)?.net ?? 0

  return (
    <section className="flex flex-col gap-3">
      <p className="text-lg">
        {yours === 0
          ? 'You are settled up.'
          : yours > 0
            ? `You are owed ${formatMoney(yours, currency)}`
            : `You owe ${formatMoney(-yours, currency)}`}
      </p>

      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {balances.map(({ memberId, net }) => (
          <li key={memberId}>
            <span className="text-muted-foreground">{nameOf(memberId)} </span>
            <span
              className={
                net > 0 ? 'text-emerald-600' : net < 0 ? 'text-destructive' : ''
              }
            >
              {net === 0
                ? '—'
                : `${net > 0 ? '+' : '−'}${formatMoney(Math.abs(net), currency)}`}
            </span>
          </li>
        ))}
      </ul>

      <Separator />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Settle up</h2>
        {transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to settle.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {transfers.map((t, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
              >
                <span className="min-w-0 break-words">
                  {nameOf(t.fromMemberId)} → {nameOf(t.toMemberId)}
                </span>
                <span className="font-medium">
                  {formatMoney(t.amountMinor, currency)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto shrink-0"
                  onClick={() => {
                    setPrefill(t)
                    setOpen(true)
                  }}
                >
                  Record
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            setPrefill(null)
            setOpen(true)
          }}
        >
          Record another payment
        </Button>
      </div>

      {open && (
        <SettlementDialog
          groupId={groupId}
          currency={currency}
          members={members}
          prefill={prefill}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  )
}
