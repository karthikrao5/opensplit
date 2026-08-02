import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import {
  addTransaction,
  deleteTransaction,
  recordSettlement,
  updateTransaction,
} from '@/lib/actions/transactions'
import { MAX_AMOUNT_MINOR } from '@/lib/money'
import { mockCurrentUser } from '../helpers/actions'
import { resetDb } from '../helpers/db'

vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(async () => {
  await resetDb()
  mockCurrentUser(null)
})

async function seed() {
  const alice = await prisma.user.create({
    data: { externalId: 'auth0|alice', displayName: 'Alice' },
  })
  const group = await prisma.group.create({
    data: {
      name: 'Trip',
      currency: 'USD',
      members: {
        create: [
          { displayName: 'Alice', userId: alice.id },
          { displayName: 'Bob', claimToken: 'tok-bob' },
          { displayName: 'Carol', claimToken: 'tok-carol' },
        ],
      },
    },
    include: { members: { orderBy: { displayName: 'asc' } } },
  })
  const [a, b, c] = group.members
  mockCurrentUser(alice)
  return { alice, group, a, b, c }
}

const baseInput = (overrides: Record<string, unknown>) => ({
  description: 'Dinner',
  amountMinor: 7650,
  occurredAt: '2026-07-28',
  ...overrides,
})

describe('addTransaction', () => {
  it('stores split rows that sum to the amount', async () => {
    const { group, a, b, c } = await seed()

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, b.id, c.id],
      }) as never,
    )
    expect(result.ok).toBe(true)

    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.kind).toBe('EXPENSE')
    expect(tx.amountMinor).toBe(7650)
    expect(tx.splits).toHaveLength(3)
    expect(tx.splits.reduce((sum, s) => sum + s.shareMinor, 0)).toBe(7650)
  })

  it('allows a payer who is not included in the split', async () => {
    const { group, a, b, c } = await seed()

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [b.id, c.id],
      }) as never,
    )
    expect(result.ok).toBe(true)

    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.splits.map((s) => s.memberId).sort()).toEqual([b.id, c.id].sort())
  })

  it('rejects an empty included-members list', async () => {
    const { group, a } = await seed()
    const result = await addTransaction(
      baseInput({ groupId: group.id, payerMemberId: a.id, includedMemberIds: [] }) as never,
    )
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a non-positive amount', async () => {
    const { group, a } = await seed()
    for (const amountMinor of [0, -100]) {
      const result = await addTransaction(
        baseInput({
          groupId: group.id,
          payerMemberId: a.id,
          includedMemberIds: [a.id],
          amountMinor,
        }) as never,
      )
      expect(result).toMatchObject({ ok: false })
    }
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects an amount above MAX_AMOUNT_MINOR', async () => {
    const { group, a } = await seed()
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id],
        amountMinor: MAX_AMOUNT_MINOR + 1,
      }) as never,
    )
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a payer from another group', async () => {
    const { group, a } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: other.members[0].id,
        includedMemberIds: [a.id],
      }) as never,
    )
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a split target from another group', async () => {
    const { group, a } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, other.members[0].id],
      }) as never,
    )
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('refuses a non-member of the group entirely', async () => {
    const { group, a } = await seed()
    const mallory = await prisma.user.create({
      data: { externalId: 'auth0|mallory', displayName: 'Mallory' },
    })
    mockCurrentUser(mallory)

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id],
      }) as never,
    )
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(0)
  })
})

describe('updateTransaction', () => {
  it('replaces the split rows rather than patching them', async () => {
    const { group, a, b, c } = await seed()
    await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, b.id, c.id],
      }) as never,
    )
    const before = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })

    const result = await updateTransaction({
      transactionId: before.id,
      groupId: group.id,
      description: 'Dinner (fixed)',
      amountMinor: 3000,
      payerMemberId: b.id,
      includedMemberIds: [a.id, b.id],
      occurredAt: '2026-07-29',
    })
    expect(result.ok).toBe(true)

    const after = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(after.description).toBe('Dinner (fixed)')
    expect(after.payerMemberId).toBe(b.id)
    expect(after.splits).toHaveLength(2)
    expect(after.splits.reduce((sum, s) => sum + s.shareMinor, 0)).toBe(3000)
    expect(await prisma.transactionSplit.count()).toBe(2)
  })

  it('refuses a transaction id from another group', async () => {
    const { group, a } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })
    const foreign = await prisma.transaction.create({
      data: {
        groupId: other.id,
        kind: 'EXPENSE',
        description: 'Theirs',
        amountMinor: 500,
        payerMemberId: other.members[0].id,
        occurredAt: new Date('2026-07-28'),
        splits: { create: [{ memberId: other.members[0].id, shareMinor: 500 }] },
      },
    })

    const result = await updateTransaction({
      transactionId: foreign.id,
      groupId: group.id,
      description: 'Hijacked',
      amountMinor: 100,
      payerMemberId: a.id,
      includedMemberIds: [a.id],
      occurredAt: '2026-07-29',
    })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect((await prisma.transaction.findFirstOrThrow({ where: { id: foreign.id } })).description).toBe('Theirs')
  })
})

describe('deleteTransaction', () => {
  it('deletes the transaction and its splits', async () => {
    const { group, a, b } = await seed()
    await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, b.id],
      }) as never,
    )
    const tx = await prisma.transaction.findFirstOrThrow()

    const result = await deleteTransaction({ groupId: group.id, transactionId: tx.id })
    expect(result.ok).toBe(true)
    expect(await prisma.transaction.count()).toBe(0)
    expect(await prisma.transactionSplit.count()).toBe(0)
  })

  it('refuses a transaction that belongs to another group', async () => {
    const { group } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })
    const foreign = await prisma.transaction.create({
      data: {
        groupId: other.id,
        kind: 'EXPENSE',
        description: 'Theirs',
        amountMinor: 500,
        payerMemberId: other.members[0].id,
        occurredAt: new Date('2026-07-28'),
        splits: { create: [{ memberId: other.members[0].id, shareMinor: 500 }] },
      },
    })

    const result = await deleteTransaction({
      groupId: group.id,
      transactionId: foreign.id,
    })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(1)
  })
})

describe('recordSettlement', () => {
  it('writes a settlement with a single split on the recipient', async () => {
    const { group, a, b } = await seed()

    const result = await recordSettlement({
      groupId: group.id,
      fromMemberId: b.id,
      toMemberId: a.id,
      amountMinor: 2550,
      occurredAt: '2026-07-29',
    })
    expect(result.ok).toBe(true)

    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.kind).toBe('SETTLEMENT')
    expect(tx.payerMemberId).toBe(b.id)
    expect(tx.splits).toHaveLength(1)
    expect(tx.splits[0].memberId).toBe(a.id)
    expect(tx.splits[0].shareMinor).toBe(2550)
  })

  it('rejects a settlement to oneself', async () => {
    const { group, a } = await seed()
    const result = await recordSettlement({
      groupId: group.id,
      fromMemberId: a.id,
      toMemberId: a.id,
      amountMinor: 100,
      occurredAt: '2026-07-29',
    })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a member from another group', async () => {
    const { group, a } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })

    const result = await recordSettlement({
      groupId: group.id,
      fromMemberId: other.members[0].id,
      toMemberId: a.id,
      amountMinor: 100,
      occurredAt: '2026-07-29',
    })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(0)
  })
})

describe('percentage split', () => {
  it('persists splitType and per-member percent, shares sum to amount', async () => {
    const { group, a, b } = await seed()

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        splitType: 'PERCENTAGE',
        percentages: [
          { memberId: a.id, percent: 60 },
          { memberId: b.id, percent: 40 },
        ],
      }) as never,
    )
    expect(result.ok).toBe(true)

    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.splitType).toBe('PERCENTAGE')
    expect(tx.splits).toHaveLength(2)
    expect(tx.splits.reduce((sum, s) => sum + s.shareMinor, 0)).toBe(7650)
    const byMember = new Map(tx.splits.map((s) => [s.memberId, s]))
    expect(byMember.get(a.id)!.shareMinor).toBe(4590) // 60% of 7650
    expect(byMember.get(a.id)!.percent).toBe(60)
    expect(byMember.get(b.id)!.shareMinor).toBe(3060) // 40% of 7650
    expect(byMember.get(b.id)!.percent).toBe(40)
  })

  it('allows a single member at 100%', async () => {
    const { group, a } = await seed()
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        splitType: 'PERCENTAGE',
        percentages: [{ memberId: a.id, percent: 100 }],
      }) as never,
    )
    expect(result.ok).toBe(true)
    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.splits).toHaveLength(1)
    expect(tx.splits[0].shareMinor).toBe(7650)
    expect(tx.splits[0].percent).toBe(100)
  })

  it('excludes a member left at 0%', async () => {
    const { group, a, b, c } = await seed()
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        splitType: 'PERCENTAGE',
        percentages: [
          { memberId: a.id, percent: 50 },
          { memberId: b.id, percent: 50 },
          { memberId: c.id, percent: 0 },
        ],
      }) as never,
    )
    expect(result.ok).toBe(true)
    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.splits).toHaveLength(2)
    expect(tx.splits.map((s) => s.memberId).sort()).toEqual([a.id, b.id].sort())
  })

  it('rejects percentages that do not sum to 100', async () => {
    const { group, a, b } = await seed()
    for (const [pa, pb] of [
      [50, 40],
      [50, 51],
    ]) {
      const result = await addTransaction(
        baseInput({
          groupId: group.id,
          payerMemberId: a.id,
          splitType: 'PERCENTAGE',
          percentages: [
            { memberId: a.id, percent: pa },
            { memberId: b.id, percent: pb },
          ],
        }) as never,
      )
      expect(result).toMatchObject({ ok: false })
    }
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a non-integer percent', async () => {
    const { group, a, b } = await seed()
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        splitType: 'PERCENTAGE',
        percentages: [
          { memberId: a.id, percent: 33.5 },
          { memberId: b.id, percent: 66.5 },
        ],
      }) as never,
    )
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a percentage split member from another group', async () => {
    const { group, a } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        splitType: 'PERCENTAGE',
        percentages: [
          { memberId: a.id, percent: 50 },
          { memberId: other.members[0].id, percent: 50 },
        ],
      }) as never,
    )
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('switches an even transaction to a percentage split', async () => {
    const { group, a, b, c } = await seed()
    await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, b.id, c.id],
      }) as never,
    )
    const before = await prisma.transaction.findFirstOrThrow()

    const result = await updateTransaction({
      transactionId: before.id,
      groupId: group.id,
      description: 'Dinner',
      amountMinor: 10000,
      payerMemberId: a.id,
      splitType: 'PERCENTAGE',
      percentages: [
        { memberId: a.id, percent: 70 },
        { memberId: b.id, percent: 30 },
      ],
      occurredAt: '2026-07-29',
    })
    expect(result.ok).toBe(true)

    const after = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(after.splitType).toBe('PERCENTAGE')
    expect(after.splits).toHaveLength(2)
    expect(after.splits.reduce((sum, s) => sum + s.shareMinor, 0)).toBe(10000)
    const byMember = new Map(after.splits.map((s) => [s.memberId, s]))
    expect(byMember.get(a.id)!.percent).toBe(70)
    expect(byMember.get(a.id)!.shareMinor).toBe(7000)
  })

  it('switches a percentage split back to even and clears percent', async () => {
    const { group, a, b } = await seed()
    await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        splitType: 'PERCENTAGE',
        percentages: [
          { memberId: a.id, percent: 60 },
          { memberId: b.id, percent: 40 },
        ],
      }) as never,
    )
    const before = await prisma.transaction.findFirstOrThrow()

    const result = await updateTransaction({
      transactionId: before.id,
      groupId: group.id,
      description: 'Dinner',
      amountMinor: 7650,
      payerMemberId: a.id,
      splitType: 'EVEN',
      includedMemberIds: [a.id, b.id],
      occurredAt: '2026-07-29',
    })
    expect(result.ok).toBe(true)

    const after = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(after.splitType).toBe('EVEN')
    expect(after.splits.every((s) => s.percent === null)).toBe(true)
  })

  it('rejects a percentage update that does not sum to 100 and leaves the transaction unchanged', async () => {
    const { group, a, b, c } = await seed()
    await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, b.id, c.id],
      }) as never,
    )
    const before = await prisma.transaction.findFirstOrThrow()

    const result = await updateTransaction({
      transactionId: before.id,
      groupId: group.id,
      description: 'Changed',
      amountMinor: 5000,
      payerMemberId: a.id,
      splitType: 'PERCENTAGE',
      percentages: [
        { memberId: a.id, percent: 50 },
        { memberId: b.id, percent: 40 },
      ],
      occurredAt: '2026-07-29',
    })
    expect(result).toMatchObject({ ok: false })

    const after = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(after.splitType).toBe('EVEN')
    expect(after.description).toBe('Dinner')
    expect(after.splits).toHaveLength(3)
  })
})

describe('exact split', () => {
  it('persists splitType EXACT with the entered per-member amounts', async () => {
    const { group, a, b, c } = await seed()

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        amountMinor: 6000,
        splitType: 'EXACT',
        amounts: [
          { memberId: a.id, shareMinor: 3000 },
          { memberId: b.id, shareMinor: 2000 },
          { memberId: c.id, shareMinor: 1000 },
        ],
      }) as never,
    )
    expect(result.ok).toBe(true)

    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.splitType).toBe('EXACT')
    expect(tx.amountMinor).toBe(6000)
    expect(tx.splits).toHaveLength(3)
    expect(tx.splits.reduce((sum, s) => sum + s.shareMinor, 0)).toBe(6000)
    const byMember = new Map(tx.splits.map((s) => [s.memberId, s]))
    expect(byMember.get(a.id)!.shareMinor).toBe(3000)
    expect(byMember.get(a.id)!.percent).toBeNull()
  })

  it('allows a single member with the whole amount', async () => {
    const { group, a } = await seed()
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        amountMinor: 4250,
        splitType: 'EXACT',
        amounts: [{ memberId: a.id, shareMinor: 4250 }],
      }) as never,
    )
    expect(result.ok).toBe(true)
    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.splits).toHaveLength(1)
    expect(tx.splits[0].shareMinor).toBe(4250)
  })

  it('excludes a member entered as 0', async () => {
    const { group, a, b, c } = await seed()
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        amountMinor: 5000,
        splitType: 'EXACT',
        amounts: [
          { memberId: a.id, shareMinor: 3000 },
          { memberId: b.id, shareMinor: 2000 },
          { memberId: c.id, shareMinor: 0 },
        ],
      }) as never,
    )
    expect(result.ok).toBe(true)
    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.splits).toHaveLength(2)
    expect(tx.splits.map((s) => s.memberId).sort()).toEqual([a.id, b.id].sort())
  })

  it('rejects amounts that do not sum to the total', async () => {
    const { group, a, b } = await seed()
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        amountMinor: 6000,
        splitType: 'EXACT',
        amounts: [
          { memberId: a.id, shareMinor: 3000 },
          { memberId: b.id, shareMinor: 2000 },
        ],
      }) as never,
    )
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a negative amount', async () => {
    const { group, a, b } = await seed()
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        amountMinor: 5000,
        splitType: 'EXACT',
        amounts: [
          { memberId: a.id, shareMinor: -1000 },
          { memberId: b.id, shareMinor: 6000 },
        ],
      }) as never,
    )
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects an exact split member from another group', async () => {
    const { group, a } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        amountMinor: 5000,
        splitType: 'EXACT',
        amounts: [
          { memberId: a.id, shareMinor: 2500 },
          { memberId: other.members[0].id, shareMinor: 2500 },
        ],
      }) as never,
    )
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('switches an even transaction to an exact split', async () => {
    const { group, a, b, c } = await seed()
    await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, b.id, c.id],
      }) as never,
    )
    const before = await prisma.transaction.findFirstOrThrow()

    const result = await updateTransaction({
      transactionId: before.id,
      groupId: group.id,
      description: 'Dinner',
      amountMinor: 5000,
      payerMemberId: a.id,
      splitType: 'EXACT',
      amounts: [
        { memberId: a.id, shareMinor: 2000 },
        { memberId: b.id, shareMinor: 3000 },
      ],
      occurredAt: '2026-07-29',
    })
    expect(result.ok).toBe(true)

    const after = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(after.splitType).toBe('EXACT')
    expect(after.amountMinor).toBe(5000)
    expect(after.splits).toHaveLength(2)
    const byMember = new Map(after.splits.map((s) => [s.memberId, s]))
    expect(byMember.get(b.id)!.shareMinor).toBe(3000)
  })

  it('switches an exact split back to even and clears percent', async () => {
    const { group, a, b } = await seed()
    await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        amountMinor: 5000,
        splitType: 'EXACT',
        amounts: [
          { memberId: a.id, shareMinor: 2000 },
          { memberId: b.id, shareMinor: 3000 },
        ],
      }) as never,
    )
    const before = await prisma.transaction.findFirstOrThrow()

    const result = await updateTransaction({
      transactionId: before.id,
      groupId: group.id,
      description: 'Dinner',
      amountMinor: 5000,
      payerMemberId: a.id,
      splitType: 'EVEN',
      includedMemberIds: [a.id, b.id],
      occurredAt: '2026-07-29',
    })
    expect(result.ok).toBe(true)

    const after = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(after.splitType).toBe('EVEN')
    expect(after.splits.every((s) => s.percent === null)).toBe(true)
    expect(after.splits.reduce((sum, s) => sum + s.shareMinor, 0)).toBe(5000)
  })
})
