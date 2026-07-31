'use client'

import { useMemo, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { addTransaction } from '@/lib/actions/transactions'
import { formatMoney, parseAmountToMinor, splitEvenly } from '@/lib/money'

export type MemberOption = { id: string; displayName: string }

export function AddTransactionDialog({
  groupId,
  currency,
  members,
  defaultPayerId,
}: {
  groupId: string
  currency: string
  members: MemberOption[]
  defaultPayerId: string
}) {
  const [open, setOpen] = useState(false)
  const [amountText, setAmountText] = useState('')
  const [description, setDescription] = useState('')
  const [occurredAt, setOccurredAt] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [payerMemberId, setPayerMemberId] = useState(defaultPayerId)
  const [included, setIncluded] = useState<string[]>(members.map((m) => m.id))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const amountMinor = parseAmountToMinor(amountText)

  const preview = useMemo(() => {
    if (!amountMinor || included.length === 0) return null
    const shares = splitEvenly(amountMinor, included)
    const values = [...shares.values()]
    const min = Math.min(...values)
    const max = Math.max(...values)
    return min === max
      ? `${formatMoney(min, currency)} each`
      : `${formatMoney(min, currency)}–${formatMoney(max, currency)} each`
  }, [amountMinor, included, currency])

  function toggle(memberId: string) {
    setIncluded((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId],
    )
  }

  function submit() {
    setError(null)
    if (!amountMinor) return setError('Enter an amount like 42.50')

    startTransition(async () => {
      const result = await addTransaction({
        groupId,
        description,
        amountMinor,
        payerMemberId,
        includedMemberIds: included,
        occurredAt,
      })
      if (!result.ok) return setError(result.error)
      setOpen(false)
      setAmountText('')
      setDescription('')
      setIncluded(members.map((m) => m.id))
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add transaction</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an expense</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="amount">Amount ({currency})</Label>
            <Input
              id="amount"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="42.50"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Dinner at Ramiro"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="payer">Paid by</Label>
            <Select value={payerMemberId} onValueChange={setPayerMemberId}>
              <SelectTrigger id="payer">
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
            <Label>Split between</Label>
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={included.includes(m.id)}
                  onCheckedChange={() => toggle(m.id)}
                />
                {m.displayName}
              </label>
            ))}
            {preview && (
              <p className="text-sm text-muted-foreground">{preview}</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
