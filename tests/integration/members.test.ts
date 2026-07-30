import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { addPlaceholderMember, removeMember } from '@/lib/actions/members'
import { mockCurrentUser } from '../helpers/actions'
import { resetDb } from '../helpers/db'

vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(async () => {
  await resetDb()
  mockCurrentUser(null)
})

async function seedGroup() {
  const alice = await prisma.user.create({
    data: { externalId: 'auth0|alice', displayName: 'Alice' },
  })
  const group = await prisma.group.create({
    data: {
      name: 'Trip',
      currency: 'USD',
      members: { create: [{ displayName: 'Alice', userId: alice.id }] },
    },
    include: { members: true },
  })
  return { alice, group, aliceMember: group.members[0] }
}

describe('addPlaceholderMember', () => {
  it('creates an unclaimed member with a claim token', async () => {
    const { alice, group } = await seedGroup()
    mockCurrentUser(alice)

    const result = await addPlaceholderMember({
      groupId: group.id,
      displayName: 'Bob',
    })
    expect(result.ok).toBe(true)

    const bob = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Bob' },
    })
    expect(bob.userId).toBeNull()
    expect(bob.claimToken).toMatch(/^[A-Za-z0-9_-]{20,}$/)
  })

  it('gives each placeholder a distinct token', async () => {
    const { alice, group } = await seedGroup()
    mockCurrentUser(alice)
    await addPlaceholderMember({ groupId: group.id, displayName: 'Bob' })
    await addPlaceholderMember({ groupId: group.id, displayName: 'Carol' })

    const tokens = (
      await prisma.groupMember.findMany({ where: { claimToken: { not: null } } })
    ).map((m) => m.claimToken)
    expect(new Set(tokens).size).toBe(2)
  })

  it('rejects a blank name', async () => {
    const { alice, group } = await seedGroup()
    mockCurrentUser(alice)
    const result = await addPlaceholderMember({ groupId: group.id, displayName: ' ' })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.groupMember.count()).toBe(1)
  })

  it('refuses a non-member', async () => {
    const { group } = await seedGroup()
    const mallory = await prisma.user.create({
      data: { externalId: 'auth0|mallory', displayName: 'Mallory' },
    })
    mockCurrentUser(mallory)

    const result = await addPlaceholderMember({ groupId: group.id, displayName: 'X' })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.groupMember.count()).toBe(1)
  })
})

describe('removeMember', () => {
  it('removes a member with no transactions', async () => {
    const { alice, group } = await seedGroup()
    mockCurrentUser(alice)
    await addPlaceholderMember({ groupId: group.id, displayName: 'Bob' })
    const bob = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Bob' },
    })

    const result = await removeMember({ groupId: group.id, memberId: bob.id })
    expect(result.ok).toBe(true)
    expect(await prisma.groupMember.count()).toBe(1)
  })

  it('refuses to remove a member who paid for something', async () => {
    const { alice, group, aliceMember } = await seedGroup()
    mockCurrentUser(alice)
    await prisma.transaction.create({
      data: {
        groupId: group.id,
        kind: 'EXPENSE',
        description: 'Lunch',
        amountMinor: 1000,
        payerMemberId: aliceMember.id,
        occurredAt: new Date('2026-07-28'),
        splits: { create: [{ memberId: aliceMember.id, shareMinor: 1000 }] },
      },
    })

    const result = await removeMember({ groupId: group.id, memberId: aliceMember.id })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.groupMember.count()).toBe(1)
  })

  it('refuses to remove a member who appears in a split', async () => {
    const { alice, group, aliceMember } = await seedGroup()
    mockCurrentUser(alice)
    await addPlaceholderMember({ groupId: group.id, displayName: 'Bob' })
    const bob = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Bob' },
    })
    await prisma.transaction.create({
      data: {
        groupId: group.id,
        kind: 'EXPENSE',
        description: 'Lunch',
        amountMinor: 1000,
        payerMemberId: aliceMember.id,
        occurredAt: new Date('2026-07-28'),
        splits: {
          create: [
            { memberId: aliceMember.id, shareMinor: 500 },
            { memberId: bob.id, shareMinor: 500 },
          ],
        },
      },
    })

    const result = await removeMember({ groupId: group.id, memberId: bob.id })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.groupMember.count()).toBe(2)
  })

  it('refuses a member id from another group', async () => {
    const { alice, group } = await seedGroup()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })
    mockCurrentUser(alice)

    const result = await removeMember({
      groupId: group.id,
      memberId: other.members[0].id,
    })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.groupMember.count()).toBe(2)
  })
})
