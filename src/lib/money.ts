export const MAX_AMOUNT_MINOR = 1_000_000_000

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR'] as const
export type Currency = (typeof CURRENCIES)[number]

/**
 * Divides amountMinor across memberIds. Every member receives
 * floor(amount / n); the remainder is handed out one minor unit at a time to
 * members in id order, so the shares always sum to exactly amountMinor.
 */
export function splitEvenly(
  amountMinor: number,
  memberIds: string[],
): Map<string, number> {
  if (memberIds.length === 0) {
    throw new Error('splitEvenly requires at least one member')
  }
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('splitEvenly requires amountMinor to be a positive integer')
  }

  const ordered = [...memberIds].sort()
  const base = Math.floor(amountMinor / ordered.length)
  let remainder = amountMinor - base * ordered.length

  const shares = new Map<string, number>()
  for (const id of ordered) {
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    shares.set(id, base + extra)
  }
  return shares
}

/**
 * Divides amountMinor across members by whole-number percentages that sum to
 * 100. Each member gets floor(amountMinor * percent / 100); the leftover minor
 * units go to the members with the largest fractional remainders (ties broken
 * by id order), so the shares always sum to exactly amountMinor.
 */
export function splitByPercentages(
  amountMinor: number,
  entries: { memberId: string; percent: number }[],
): Map<string, number> {
  if (entries.length === 0) {
    throw new Error('splitByPercentages requires at least one member')
  }
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(
      'splitByPercentages requires amountMinor to be a positive integer',
    )
  }
  const ids = entries.map((e) => e.memberId)
  if (new Set(ids).size !== ids.length) {
    throw new Error('splitByPercentages requires unique member ids')
  }
  for (const { percent } of entries) {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new Error(
        'splitByPercentages requires each percent to be a whole number between 0 and 100',
      )
    }
  }
  if (entries.reduce((total, e) => total + e.percent, 0) !== 100) {
    throw new Error('splitByPercentages requires the percentages to sum to 100')
  }

  // Sort by id first so the later stable sort by remainder tie-breaks
  // deterministically in id order, matching splitEvenly's determinism.
  const ordered = [...entries].sort((a, b) =>
    a.memberId.localeCompare(b.memberId),
  )

  const shares = new Map<string, number>()
  const remainders: { memberId: string; rem: number }[] = []
  let allocated = 0
  for (const { memberId, percent } of ordered) {
    const numerator = amountMinor * percent
    const base = Math.floor(numerator / 100)
    shares.set(memberId, base)
    allocated += base
    remainders.push({ memberId, rem: numerator % 100 })
  }

  let leftover = amountMinor - allocated
  for (const { memberId } of [...remainders].sort((a, b) => b.rem - a.rem)) {
    if (leftover <= 0) break
    shares.set(memberId, (shares.get(memberId) ?? 0) + 1)
    leftover -= 1
  }
  return shares
}

/**
 * "Splits" amountMinor by exact per-member amounts that must sum to it — the
 * entered shares ARE the result, so this only validates and returns them.
 */
export function splitByAmounts(
  amountMinor: number,
  entries: { memberId: string; shareMinor: number }[],
): Map<string, number> {
  if (entries.length === 0) {
    throw new Error('splitByAmounts requires at least one member')
  }
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(
      'splitByAmounts requires amountMinor to be a positive integer',
    )
  }
  const ids = entries.map((e) => e.memberId)
  if (new Set(ids).size !== ids.length) {
    throw new Error('splitByAmounts requires unique member ids')
  }
  for (const { shareMinor } of entries) {
    if (!Number.isInteger(shareMinor) || shareMinor < 0) {
      throw new Error(
        'splitByAmounts requires each amount to be a non-negative integer',
      )
    }
  }
  if (entries.reduce((total, e) => total + e.shareMinor, 0) !== amountMinor) {
    throw new Error('splitByAmounts requires the amounts to sum to the total')
  }
  return new Map(entries.map((e) => [e.memberId, e.shareMinor]))
}

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amountMinor / 100)
}

/**
 * Parses user-typed currency text like "42.50" into 4250 minor units.
 * Returns null for anything that is not a positive amount with at most two
 * decimal places.
 */
export function parseAmountToMinor(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null

  const [whole, fraction = ''] = trimmed.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}
