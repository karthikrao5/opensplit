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

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amountMinor / 100)
}
