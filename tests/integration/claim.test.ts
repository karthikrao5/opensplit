import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { claimMember } from '@/lib/actions/members'
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
  const bob = await prisma.user.create({
    data: { externalId: 'auth0|bob', displayName: 'Bob' },
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
    include: { members: true },
  })
  return { alice, bob, group }
}

describe('claimMember', () => {
  it('links the member to the user and clears the token', async () => {
    const { bob, group } = await seed()
    mockCurrentUser(bob)

    const result = await claimMember({ token: 'tok-bob' })
    expect(result).toMatchObject({ ok: true, groupId: group.id })

    const member = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Bob' },
    })
    expect(member.userId).toBe(bob.id)
    expect(member.claimToken).toBeNull()
  })

  it('sets a custom, trimmed displayName when one is provided', async () => {
    const { bob, group } = await seed()
    mockCurrentUser(bob)

    const result = await claimMember({ token: 'tok-bob', displayName: '  Bobby  ' })
    expect(result).toMatchObject({ ok: true, groupId: group.id })

    const member = await prisma.groupMember.findFirstOrThrow({
      where: { userId: bob.id },
    })
    expect(member.displayName).toBe('Bobby')
    expect(member.claimToken).toBeNull()
  })

  it('refuses a token that has already been used', async () => {
    const { bob } = await seed()
    mockCurrentUser(bob)
    await claimMember({ token: 'tok-bob' })

    const other = await prisma.user.create({
      data: { externalId: 'auth0|other', displayName: 'Other' },
    })
    mockCurrentUser(other)

    const result = await claimMember({ token: 'tok-bob' })
    expect(result).toMatchObject({ ok: false })
    const member = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Bob' },
    })
    expect(member.userId).toBe(bob.id)
  })

  it('refuses an unknown token', async () => {
    const { bob } = await seed()
    mockCurrentUser(bob)
    expect(await claimMember({ token: 'nope' })).toMatchObject({ ok: false })
  })

  it('refuses a user who already holds a slot in that group', async () => {
    const { alice } = await seed()
    mockCurrentUser(alice)

    const result = await claimMember({ token: 'tok-carol' })
    expect(result).toMatchObject({ ok: false })

    const carol = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Carol' },
    })
    expect(carol.userId).toBeNull()
    expect(carol.claimToken).toBe('tok-carol')
  })

  it('lets the same user claim slots in two different groups', async () => {
    const { bob } = await seed()
    const second = await prisma.group.create({
      data: {
        name: 'Second',
        currency: 'USD',
        members: { create: [{ displayName: 'Bob', claimToken: 'tok-bob-2' }] },
      },
    })
    mockCurrentUser(bob)

    expect(await claimMember({ token: 'tok-bob' })).toMatchObject({ ok: true })
    expect(await claimMember({ token: 'tok-bob-2' })).toMatchObject({
      ok: true,
      groupId: second.id,
    })
  })
})
