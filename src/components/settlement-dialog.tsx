'use client'

import { useState, useTransition } from 'react'
import type { MemberOption } from '@/components/add-transaction-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { recordSettlement } from '@/lib/actions/transactions'
import { parseAmountToMinor } from '@/lib/money'

export function SettlementDialog({
  groupId,
  currency,
  members,
  prefill,
  onClose,
}: {
  groupId: string
  currency: string
  members: MemberOption[]
  prefill: { fromMemberId: string; toMemberId: string; amountMinor: number } | null
  onClose: () => void
}) {
  const [fromMemberId, setFrom] = useState(prefill?.fromMemberId ?? members[0].id)
  const [toMemberId, setTo] = useState(prefill?.toMemberId ?? members[1]?.id ?? members[0].id)
  const [amountText, setAmountText] = useState(
    prefill ? (prefill.amountMinor / 100).toFixed(2) : '',
  )
  const [occurredAt, setOccurredAt] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    const amountMinor = parseAmountToMinor(amountText)
    if (!amountMinor) return setError('Enter an amount like 25.00')

    startTransition(async () => {
      const result = await recordSettlement({
        groupId,
        fromMemberId,
        toMemberId,
        amountMinor,
        occurredAt,
      })
      if (!result.ok) return setError(result.error)
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="from">From</Label>
            <Select value={fromMemberId} onValueChange={setFrom}>
              <SelectTrigger id="from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="to">To</Label>
            <Select value={toMemberId} onValueChange={setTo}>
              <SelectTrigger id="to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="settle-amount">Amount ({currency})</Label>
            <Input
              id="settle-amount"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="settle-date">Date</Label>
            <Input
              id="settle-date"
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
