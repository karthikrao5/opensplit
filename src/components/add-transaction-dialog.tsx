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
import { addTransaction, updateTransaction } from '@/lib/actions/transactions'
import {
  formatMoney,
  parseAmountToMinor,
  splitByPercentages,
  splitEvenly,
} from '@/lib/money'

export type MemberOption = { id: string; displayName: string }

/** An existing expense to edit. When present, the dialog runs in edit mode. */
export type EditingTransaction = {
  transactionId: string
  description: string
  amountMinor: number
  payerMemberId: string
  includedMemberIds: string[]
  occurredAt: string // YYYY-MM-DD
  splitType: 'EVEN' | 'PERCENTAGE'
  percentages: { memberId: string; percent: number }[]
}

export function AddTransactionDialog({
  groupId,
  currency,
  members,
  defaultPayerId,
  editing,
  onClose,
}: {
  groupId: string
  currency: string
  members: MemberOption[]
  defaultPayerId: string
  // Edit mode: the parent mounts this dialog (already open) with the expense to
  // edit and unmounts it via onClose. Omit both for the default add mode.
  editing?: EditingTransaction
  onClose?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [amountText, setAmountText] = useState(
    editing ? (editing.amountMinor / 100).toFixed(2) : '',
  )
  const [description, setDescription] = useState(editing?.description ?? '')
  const [occurredAt, setOccurredAt] = useState(
    editing?.occurredAt ?? new Date().toISOString().slice(0, 10),
  )
  const [payerMemberId, setPayerMemberId] = useState(
    editing?.payerMemberId ?? defaultPayerId,
  )
  const [included, setIncluded] = useState<string[]>(
    editing?.includedMemberIds ?? members.map((m) => m.id),
  )
  const [splitType, setSplitType] = useState<'EVEN' | 'PERCENTAGE'>(
    editing?.splitType ?? 'EVEN',
  )
  const [percentTexts, setPercentTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (editing?.percentages ?? []).map((p) => [p.memberId, String(p.percent)]),
    ),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const amountMinor = parseAmountToMinor(amountText)

  // Members with a valid, non-zero whole-number percentage (blank/malformed
  // input is simply excluded, so the total falls short of 100 rather than erroring).
  const percentEntries = useMemo(
    () =>
      members
        .map((m) => ({ memberId: m.id, percent: Number(percentTexts[m.id] ?? '') }))
        .filter((e) => Number.isInteger(e.percent) && e.percent > 0),
    [members, percentTexts],
  )
  const percentTotal = percentEntries.reduce((sum, e) => sum + e.percent, 0)

  const preview = useMemo(() => {
    if (!amountMinor) return null
    try {
      let shares: Map<string, number>
      if (splitType === 'PERCENTAGE') {
        if (percentTotal !== 100) return null
        shares = splitByPercentages(amountMinor, percentEntries)
      } else {
        if (included.length === 0) return null
        shares = splitEvenly(amountMinor, included)
      }
      const values = [...shares.values()]
      const min = Math.min(...values)
      const max = Math.max(...values)
      return min === max
        ? `${formatMoney(min, currency)} each`
        : `${formatMoney(min, currency)}–${formatMoney(max, currency)}`
    } catch {
      return null
    }
  }, [amountMinor, splitType, included, percentEntries, percentTotal, currency])

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

    const base = { groupId, description, amountMinor, payerMemberId, occurredAt }
    let payload
    if (splitType === 'PERCENTAGE') {
      if (percentTotal !== 100) {
        return setError('Percentages must add up to 100')
      }
      payload = { ...base, splitType: 'PERCENTAGE' as const, percentages: percentEntries }
    } else {
      payload = { ...base, splitType: 'EVEN' as const, includedMemberIds: included }
    }

    startTransition(async () => {
      const result = editing
        ? await updateTransaction({
            transactionId: editing.transactionId,
            ...payload,
          })
        : await addTransaction(payload)
      if (!result.ok) return setError(result.error)

      if (editing) {
        onClose?.() // parent unmounts this instance; no field resets needed
        return
      }
      setOpen(false)
      setAmountText('')
      setDescription('')
      setIncluded(members.map((m) => m.id))
      setSplitType('EVEN')
      setPercentTexts({})
    })
  }

  return (
    <Dialog
      open={editing ? true : open}
      onOpenChange={editing ? (next) => !next && onClose?.() : setOpen}
    >
      {!editing && (
        <DialogTrigger asChild>
          <Button>Add transaction</Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit expense' : 'Add an expense'}</DialogTitle>
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
            <Label>Split</Label>
            <div
              className="inline-flex w-fit rounded-md border"
              role="group"
              aria-label="Split type"
            >
              <Button
                type="button"
                variant={splitType === 'EVEN' ? 'default' : 'ghost'}
                size="sm"
                className="rounded-r-none"
                onClick={() => setSplitType('EVEN')}
              >
                Evenly
              </Button>
              <Button
                type="button"
                variant={splitType === 'PERCENTAGE' ? 'default' : 'ghost'}
                size="sm"
                className="rounded-l-none border-l"
                onClick={() => setSplitType('PERCENTAGE')}
              >
                By percentage
              </Button>
            </div>

            {splitType === 'EVEN'
              ? members.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={included.includes(m.id)}
                      onCheckedChange={() => toggle(m.id)}
                    />
                    {m.displayName}
                  </label>
                ))
              : members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 break-words">
                      {m.displayName}
                    </span>
                    <Input
                      className="w-20"
                      inputMode="numeric"
                      aria-label={`${m.displayName} percentage`}
                      value={percentTexts[m.id] ?? ''}
                      onChange={(e) =>
                        setPercentTexts((prev) => ({
                          ...prev,
                          [m.id]: e.target.value,
                        }))
                      }
                      placeholder="0"
                    />
                    <span className="text-muted-foreground">%</span>
                  </div>
                ))}

            {splitType === 'PERCENTAGE' && (
              <p
                className={
                  percentTotal === 100
                    ? 'text-sm text-muted-foreground'
                    : 'text-sm text-destructive'
                }
              >
                Total: {percentTotal}%
                {percentTotal === 100 ? '' : ' (must add up to 100)'}
              </p>
            )}

            {preview && (
              <p className="text-sm text-muted-foreground">{preview}</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={
              pending || (splitType === 'PERCENTAGE' && percentTotal !== 100)
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
