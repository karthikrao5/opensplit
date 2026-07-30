import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../helpers/db'

beforeEach(resetDb)

describe('schema', () => {
  it('stores a group with a claimed and a placeholder member', async () => {
    const user = await prisma.user.create({
      data: { externalId: 'auth0|alice', displayName: 'Alice' },
    })
    const group = await prisma.group.create({
      data: {
        name: 'Trip to Lisbon',
        currency: 'USD',
        members: {
          create: [
            { displayName: 'Alice', userId: user.id },
            { displayName: 'Bob', claimToken: 'tok-bob' },
          ],
        },
      },
      include: { members: true },
    })

    expect(group.members).toHaveLength(2)
    expect(group.members.filter((m) => m.userId === null)).toHaveLength(1)
  })

  it('allows many placeholder members in one group', async () => {
    const group = await prisma.group.create({ data: { name: 'G', currency: 'USD' } })
    await prisma.groupMember.create({
      data: { groupId: group.id, displayName: 'Bob', claimToken: 't1' },
    })
    await prisma.groupMember.create({
      data: { groupId: group.id, displayName: 'Carol', claimToken: 't2' },
    })
    expect(await prisma.groupMember.count({ where: { groupId: group.id } })).toBe(2)
  })

  it('refuses two memberships for the same user in one group', async () => {
    const user = await prisma.user.create({
      data: { externalId: 'auth0|dup', displayName: 'Dup' },
    })
    const group = await prisma.group.create({ data: { name: 'G', currency: 'USD' } })
    await prisma.groupMember.create({
      data: { groupId: group.id, displayName: 'One', userId: user.id },
    })

    await expect(
      prisma.groupMember.create({
        data: { groupId: group.id, displayName: 'Two', userId: user.id },
      }),
    ).rejects.toThrow()
  })

  it('cascades split deletion when a transaction is deleted', async () => {
    const group = await prisma.group.create({ data: { name: 'G', currency: 'USD' } })
    const member = await prisma.groupMember.create({
      data: { groupId: group.id, displayName: 'Solo', claimToken: 't' },
    })
    const tx = await prisma.transaction.create({
      data: {
        groupId: group.id,
        kind: 'EXPENSE',
        description: 'Lunch',
        amountMinor: 500,
        payerMemberId: member.id,
        occurredAt: new Date('2026-07-28'),
        splits: { create: [{ memberId: member.id, shareMinor: 500 }] },
      },
    })

    await prisma.transaction.delete({ where: { id: tx.id } })
    expect(await prisma.transactionSplit.count()).toBe(0)
  })
})
