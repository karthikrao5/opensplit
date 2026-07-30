export type BalanceTransaction = {
  payerMemberId: string
  amountMinor: number
  splits: { memberId: string; shareMinor: number }[]
}

export type Transfer = {
  fromMemberId: string
  toMemberId: string
  amountMinor: number
}

/**
 * Net position per member: what they paid out, minus what they owe.
 * Positive means the group owes them. Always sums to zero.
 */
export function computeBalances(
  memberIds: string[],
  transactions: BalanceTransaction[],
): Map<string, number> {
  const balances = new Map<string, number>(memberIds.map((id) => [id, 0]))
  const add = (id: string, delta: number) =>
    balances.set(id, (balances.get(id) ?? 0) + delta)

  for (const tx of transactions) {
    add(tx.payerMemberId, tx.amountMinor)
    for (const split of tx.splits) add(split.memberId, -split.shareMinor)
  }
  return balances
}

/**
 * Greedy minimum-cash-flow: repeatedly match the largest debtor against the
 * largest creditor and transfer the smaller of the two amounts.
 *
 * Not provably minimal in every case — the general problem is NP-hard — but
 * optimal in practice at the group sizes this app targets, and it emits at
 * most n-1 transfers. This is intentional, not a placeholder.
 */
export function suggestTransfers(balances: Map<string, number>): Transfer[] {
  const byMagnitudeThenId = (
    a: { id: string; amount: number },
    b: { id: string; amount: number },
  ) => b.amount - a.amount || a.id.localeCompare(b.id)

  const debtors = [...balances]
    .filter(([, net]) => net < 0)
    .map(([id, net]) => ({ id, amount: -net }))
    .sort(byMagnitudeThenId)

  const creditors = [...balances]
    .filter(([, net]) => net > 0)
    .map(([id, net]) => ({ id, amount: net }))
    .sort(byMagnitudeThenId)

  const transfers: Transfer[] = []
  let d = 0
  let c = 0

  while (d < debtors.length && c < creditors.length) {
    const amountMinor = Math.min(debtors[d].amount, creditors[c].amount)
    transfers.push({
      fromMemberId: debtors[d].id,
      toMemberId: creditors[c].id,
      amountMinor,
    })
    debtors[d].amount -= amountMinor
    creditors[c].amount -= amountMinor
    if (debtors[d].amount === 0) d++
    if (creditors[c].amount === 0) c++
  }

  return transfers
}
