import { describe, expect, it } from 'vitest'
import { formatMoney, splitEvenly } from '@/lib/money'

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

describe('formatMoney', () => {
  it('renders minor units as a currency string', () => {
    expect(formatMoney(4250, 'USD')).toBe('$42.50')
    expect(formatMoney(0, 'USD')).toBe('$0.00')
  })
})
