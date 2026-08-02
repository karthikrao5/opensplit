import { describe, expect, it } from 'vitest'
import {
  formatMoney,
  parseAmountToMinor,
  splitByAmounts,
  splitByPercentages,
  splitEvenly,
} from '@/lib/money'

const sum = (shares: Map<string, number>) =>
  [...shares.values()].reduce((a, b) => a + b, 0)

describe('splitEvenly', () => {
  it('divides an evenly divisible amount', () => {
    const shares = splitEvenly(900, ['a', 'b', 'c'])
    expect([...shares.values()]).toEqual([300, 300, 300])
  })

  it('distributes the remainder one minor unit at a time', () => {
    const shares = splitEvenly(1000, ['a', 'b', 'c'])
    expect(shares.get('a')).toBe(334)
    expect(shares.get('b')).toBe(333)
    expect(shares.get('c')).toBe(333)
  })

  it('always sums to the exact amount', () => {
    for (const amount of [1, 2, 7, 10, 99, 100, 101, 12345, 1_000_000_000]) {
      for (const n of [1, 2, 3, 5, 7, 11]) {
        const ids = Array.from({ length: n }, (_, i) => `m${i}`)
        expect(sum(splitEvenly(amount, ids))).toBe(amount)
      }
    }
  })

  it('gives zero shares when the amount is smaller than the member count', () => {
    const shares = splitEvenly(1, ['a', 'b', 'c', 'd', 'e'])
    expect(sum(shares)).toBe(1)
    expect([...shares.values()].filter((v) => v === 0)).toHaveLength(4)
  })

  it('is deterministic regardless of input ordering', () => {
    const forward = splitEvenly(1000, ['a', 'b', 'c'])
    const reversed = splitEvenly(1000, ['c', 'b', 'a'])
    expect([...reversed.entries()].sort()).toEqual([...forward.entries()].sort())
  })

  it('rejects an empty member list', () => {
    expect(() => splitEvenly(100, [])).toThrow(/at least one member/)
  })

  it('rejects a non-positive or non-integer amount', () => {
    expect(() => splitEvenly(0, ['a'])).toThrow(/positive integer/)
    expect(() => splitEvenly(-5, ['a'])).toThrow(/positive integer/)
    expect(() => splitEvenly(1.5, ['a'])).toThrow(/positive integer/)
  })
})

describe('splitByPercentages', () => {
  it('divides proportionally when it comes out even', () => {
    const shares = splitByPercentages(1000, [
      { memberId: 'a', percent: 50 },
      { memberId: 'b', percent: 30 },
      { memberId: 'c', percent: 20 },
    ])
    expect(shares.get('a')).toBe(500)
    expect(shares.get('b')).toBe(300)
    expect(shares.get('c')).toBe(200)
  })

  it('gives the leftover unit to the largest remainder, deterministically', () => {
    // 10¢ at 34/33/33: bases 3/3/3 = 9, leftover 1 → highest remainder (a, .40)
    const shares = splitByPercentages(10, [
      { memberId: 'a', percent: 34 },
      { memberId: 'b', percent: 33 },
      { memberId: 'c', percent: 33 },
    ])
    expect(shares.get('a')).toBe(4)
    expect(shares.get('b')).toBe(3)
    expect(shares.get('c')).toBe(3)
  })

  it('always sums to the exact amount', () => {
    const partitions = [
      [100],
      [50, 50],
      [34, 33, 33],
      [60, 40],
      [10, 20, 30, 40],
    ]
    for (const amount of [1, 2, 7, 10, 99, 100, 101, 12345, 1_000_000_000]) {
      for (const partition of partitions) {
        const entries = partition.map((percent, i) => ({
          memberId: `m${i}`,
          percent,
        }))
        expect(sum(splitByPercentages(amount, entries))).toBe(amount)
      }
    }
  })

  it('gives a zero share when a percent is too small for the amount', () => {
    const shares = splitByPercentages(1, [
      { memberId: 'a', percent: 50 },
      { memberId: 'b', percent: 50 },
    ])
    expect(sum(shares)).toBe(1)
    expect([...shares.values()].filter((v) => v === 0)).toHaveLength(1)
  })

  it('is deterministic regardless of entry ordering', () => {
    const forward = splitByPercentages(10, [
      { memberId: 'a', percent: 34 },
      { memberId: 'b', percent: 33 },
      { memberId: 'c', percent: 33 },
    ])
    const reversed = splitByPercentages(10, [
      { memberId: 'c', percent: 33 },
      { memberId: 'b', percent: 33 },
      { memberId: 'a', percent: 34 },
    ])
    expect([...reversed.entries()].sort()).toEqual([...forward.entries()].sort())
  })

  it('rejects an empty member list', () => {
    expect(() => splitByPercentages(100, [])).toThrow(/at least one member/)
  })

  it('rejects a non-positive or non-integer amount', () => {
    const entries = [{ memberId: 'a', percent: 100 }]
    expect(() => splitByPercentages(0, entries)).toThrow(/positive integer/)
    expect(() => splitByPercentages(-5, entries)).toThrow(/positive integer/)
    expect(() => splitByPercentages(1.5, entries)).toThrow(/positive integer/)
  })

  it('rejects a non-integer, negative, or out-of-range percent', () => {
    expect(() =>
      splitByPercentages(100, [
        { memberId: 'a', percent: 33.5 },
        { memberId: 'b', percent: 66.5 },
      ]),
    ).toThrow(/whole number between 0 and 100/)
    expect(() =>
      splitByPercentages(100, [
        { memberId: 'a', percent: -10 },
        { memberId: 'b', percent: 110 },
      ]),
    ).toThrow(/whole number between 0 and 100/)
  })

  it('rejects percentages that do not sum to 100', () => {
    expect(() =>
      splitByPercentages(100, [
        { memberId: 'a', percent: 50 },
        { memberId: 'b', percent: 49 },
      ]),
    ).toThrow(/sum to 100/)
    expect(() =>
      splitByPercentages(100, [
        { memberId: 'a', percent: 50 },
        { memberId: 'b', percent: 51 },
      ]),
    ).toThrow(/sum to 100/)
  })

  it('rejects duplicate member ids', () => {
    expect(() =>
      splitByPercentages(100, [
        { memberId: 'a', percent: 50 },
        { memberId: 'a', percent: 50 },
      ]),
    ).toThrow(/unique member ids/)
  })
})

describe('splitByAmounts', () => {
  it('returns the entered amounts when they sum to the total', () => {
    const shares = splitByAmounts(6000, [
      { memberId: 'a', shareMinor: 3000 },
      { memberId: 'b', shareMinor: 2000 },
      { memberId: 'c', shareMinor: 1000 },
    ])
    expect(shares.get('a')).toBe(3000)
    expect(shares.get('b')).toBe(2000)
    expect(shares.get('c')).toBe(1000)
    expect(sum(shares)).toBe(6000)
  })

  it('allows a single member with the whole amount', () => {
    const shares = splitByAmounts(4250, [{ memberId: 'a', shareMinor: 4250 }])
    expect(shares.get('a')).toBe(4250)
  })

  it('rejects an empty member list', () => {
    expect(() => splitByAmounts(100, [])).toThrow(/at least one member/)
  })

  it('rejects a non-positive or non-integer amount', () => {
    const entries = [{ memberId: 'a', shareMinor: 100 }]
    expect(() => splitByAmounts(0, entries)).toThrow(/positive integer/)
    expect(() => splitByAmounts(1.5, entries)).toThrow(/positive integer/)
  })

  it('rejects a negative or non-integer share', () => {
    expect(() =>
      splitByAmounts(100, [
        { memberId: 'a', shareMinor: -50 },
        { memberId: 'b', shareMinor: 150 },
      ]),
    ).toThrow(/non-negative integer/)
    expect(() =>
      splitByAmounts(100, [
        { memberId: 'a', shareMinor: 50.5 },
        { memberId: 'b', shareMinor: 49.5 },
      ]),
    ).toThrow(/non-negative integer/)
  })

  it('rejects amounts that do not sum to the total', () => {
    expect(() =>
      splitByAmounts(100, [
        { memberId: 'a', shareMinor: 60 },
        { memberId: 'b', shareMinor: 30 },
      ]),
    ).toThrow(/sum to the total/)
    expect(() =>
      splitByAmounts(100, [
        { memberId: 'a', shareMinor: 60 },
        { memberId: 'b', shareMinor: 50 },
      ]),
    ).toThrow(/sum to the total/)
  })

  it('rejects duplicate member ids', () => {
    expect(() =>
      splitByAmounts(100, [
        { memberId: 'a', shareMinor: 50 },
        { memberId: 'a', shareMinor: 50 },
      ]),
    ).toThrow(/unique member ids/)
  })
})

describe('formatMoney', () => {
  it('renders minor units as a currency string', () => {
    expect(formatMoney(4250, 'USD')).toBe('$42.50')
    expect(formatMoney(0, 'USD')).toBe('$0.00')
  })
})

describe('parseAmountToMinor', () => {
  it('parses whole and fractional amounts', () => {
    expect(parseAmountToMinor('42.50')).toBe(4250)
    expect(parseAmountToMinor('42')).toBe(4200)
    expect(parseAmountToMinor('0.07')).toBe(7)
    expect(parseAmountToMinor(' 12.3 ')).toBe(1230)
  })

  it('rejects junk, negatives, zero, and extra precision', () => {
    for (const text of ['', 'abc', '-5', '0', '0.00', '1.234', '1,5', '1.']) {
      expect(parseAmountToMinor(text)).toBeNull()
    }
  })
})
