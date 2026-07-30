import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { NotMemberError, requireGroupMemberIds, requireMembership } from '@/lib/membership'
import { mockCurrentUser } from '../helpers/actions'
import { resetDb } from '../helpers/db'

vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)

beforeEach(async () => {
  await resetDb()
  mockCurrentUser(null)
})

async function seed() {
  const alice = await prisma.user.create({
    data: { externalId: 'auth0|alice', displayName: 'Alice' },
  })
  const mallory = await prisma.user.create({
    data: { externalId: 'auth0|mallory', displayName: 'Mallory' },
  })
  const group = await prisma.group.create({
    data: {
      name: 'Trip',
      currency: 'USD',
      members: {
        create: [
          { displayName: 'Alice', userId: alice.id },
          { displayName: 'Bob', claimToken: 'tok-bob' },
        ],
      },
    },
    include: { members: true },
  })
  const other = await prisma.group.create({
    data: {
      name: 'Other',
      currency: 'USD',
      members: { create: [{ displayName: 'Outsider', claimToken: 'tok-out' }] },
    },
    include: { members: true },
  })
  return { alice, mallory, group, other }
}

describe('requireMembership', () => {
  it('returns the user, their member row, and the group', async () => {
    const { alice, group } = await seed()
    mockCurrentUser(alice)

    const result = await requireMembership(group.id)
    expect(result.user.id).toBe(alice.id)
    expect(result.member.displayName).toBe('Alice')
    expect(result.group.name).toBe('Trip')
  })

  it('throws NotMemberError for a signed-in non-member', async () => {
    const { mallory, group } = await seed()
    mockCurrentUser(mallory)

    await expect(requireMembership(group.id)).rejects.toThrow(NotMemberError)
  })

  it('throws NotMemberError for a group that does not exist', async () => {
    const { alice } = await seed()
    mockCurrentUser(alice)

    await expect(
      requireMembership('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotMemberError)
  })

  it('does not treat an unclaimed member slot as membership', async () => {
    const { group } = await seed()
    const nobody = await prisma.user.create({
      data: { externalId: 'auth0|nobody', displayName: 'Nobody' },
    })
    mockCurrentUser(nobody)

    await expect(requireMembership(group.id)).rejects.toThrow(NotMemberError)
  })
})

describe('requireGroupMemberIds', () => {
  it('accepts ids that belong to the group', async () => {
    const { group } = await seed()
    const ids = group.members.map((m) => m.id)
    await expect(requireGroupMemberIds(group.id, ids)).resolves.toBeUndefined()
  })

  it('rejects an id from another group', async () => {
    const { group, other } = await seed()
    await expect(
      requireGroupMemberIds(group.id, [other.members[0].id]),
    ).rejects.toThrow(NotMemberError)
  })

  it('rejects a mix of valid and foreign ids', async () => {
    const { group, other } = await seed()
    await expect(
      requireGroupMemberIds(group.id, [group.members[0].id, other.members[0].id]),
    ).rejects.toThrow(NotMemberError)
  })

  it('rejects an unknown id', async () => {
    const { group } = await seed()
    await expect(
      requireGroupMemberIds(group.id, ['00000000-0000-0000-0000-000000000000']),
    ).rejects.toThrow(NotMemberError)
  })
})
