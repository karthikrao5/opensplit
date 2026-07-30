import { describe, expect, it } from 'vitest'
import {
  computeBalances,
  suggestTransfers,
  type BalanceTransaction,
} from '@/lib/balances'

const dinner: BalanceTransaction = {
  payerMemberId: 'alice',
  amountMinor: 7650,
  splits: [
    { memberId: 'alice', shareMinor: 2550 },
    { memberId: 'bob', shareMinor: 2550 },
    { memberId: 'carol', shareMinor: 2550 },
  ],
}

describe('computeBalances', () => {
  it('credits the payer and debits each split target', () => {
    const balances = computeBalances(['alice', 'bob', 'carol'], [dinner])
    expect(balances.get('alice')).toBe(5100)
    expect(balances.get('bob')).toBe(-2550)
    expect(balances.get('carol')).toBe(-2550)
  })

  it('includes members with no activity at zero', () => {
    const balances = computeBalances(['alice', 'bob', 'carol', 'dave'], [dinner])
    expect(balances.get('dave')).toBe(0)
  })

  it('always sums to zero', () => {
    const taxi: BalanceTransaction = {
      payerMemberId: 'bob',
      amountMinor: 1200,
      splits: [
        { memberId: 'bob', shareMinor: 600 },
        { memberId: 'carol', shareMinor: 600 },
      ],
    }
    const balances = computeBalances(['alice', 'bob', 'carol'], [dinner, taxi])
    const total = [...balances.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(0)
  })

  it('treats a settlement as an ordinary transaction that offsets balances', () => {
    const settlement: BalanceTransaction = {
      payerMemberId: 'bob',
      amountMinor: 2550,
      splits: [{ memberId: 'alice', shareMinor: 2550 }],
    }
    const balances = computeBalances(
      ['alice', 'bob', 'carol'],
      [dinner, settlement],
    )
    expect(balances.get('bob')).toBe(0)
    expect(balances.get('alice')).toBe(2550)
  })

  it('returns all zeros when there are no transactions', () => {
    const balances = computeBalances(['alice', 'bob'], [])
    expect([...balances.values()]).toEqual([0, 0])
  })
})

const applyTransfers = (
  balances: Map<string, number>,
  transfers: { fromMemberId: string; toMemberId: string; amountMinor: number }[],
) => {
  const result = new Map(balances)
  for (const t of transfers) {
    result.set(t.fromMemberId, (result.get(t.fromMemberId) ?? 0) + t.amountMinor)
    result.set(t.toMemberId, (result.get(t.toMemberId) ?? 0) - t.amountMinor)
  }
  return result
}

describe('suggestTransfers', () => {
  it('zeroes every balance', () => {
    const balances = new Map([
      ['alice', 4250],
      ['bob', -1700],
      ['carol', -2550],
    ])
    const settled = applyTransfers(balances, suggestTransfers(balances))
    expect([...settled.values()].every((v) => v === 0)).toBe(true)
  })

  it('emits at most n-1 transfers', () => {
    const balances = new Map([
      ['a', 5000],
      ['b', 3000],
      ['c', -2000],
      ['d', -2500],
      ['e', -3500],
    ])
    expect(suggestTransfers(balances).length).toBeLessThanOrEqual(4)
  })

  it('splits one debtor across two creditors when needed', () => {
    const balances = new Map([
      ['debtor', -3000],
      ['big', 2000],
      ['small', 1000],
    ])
    const transfers = suggestTransfers(balances)
    expect(transfers).toEqual([
      { fromMemberId: 'debtor', toMemberId: 'big', amountMinor: 2000 },
      { fromMemberId: 'debtor', toMemberId: 'small', amountMinor: 1000 },
    ])
  })

  it('returns nothing when everyone is square', () => {
    expect(suggestTransfers(new Map([['a', 0], ['b', 0]]))).toEqual([])
  })

  it('never emits a zero-amount transfer', () => {
    const balances = new Map([['a', 100], ['b', -100], ['c', 0]])
    expect(suggestTransfers(balances).every((t) => t.amountMinor > 0)).toBe(true)
  })
})
