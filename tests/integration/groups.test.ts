import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { createGroup, renameGroup } from '@/lib/actions/groups'
import { mockCurrentUser } from '../helpers/actions'
import { resetDb } from '../helpers/db'

vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(async () => {
  await resetDb()
  mockCurrentUser(null)
})

const makeUser = (tag: string) =>
  prisma.user.create({
    data: { externalId: `auth0|${tag}`, displayName: tag },
  })

describe('createGroup', () => {
  it('creates the group and the creator membership together', async () => {
    const alice = await makeUser('alice')
    mockCurrentUser(alice)

    const result = await createGroup({ name: 'Trip to Lisbon', currency: 'USD' })
    expect(result.ok).toBe(true)

    const group = await prisma.group.findFirstOrThrow({ include: { members: true } })
    expect(group.name).toBe('Trip to Lisbon')
    expect(group.members).toHaveLength(1)
    expect(group.members[0].userId).toBe(alice.id)
    expect(group.members[0].displayName).toBe('alice')
    expect(group.members[0].claimToken).toBeNull()
  })

  it('rejects a blank name', async () => {
    mockCurrentUser(await makeUser('alice'))
    const result = await createGroup({ name: '   ', currency: 'USD' })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.group.count()).toBe(0)
  })

  it('rejects an unsupported currency', async () => {
    mockCurrentUser(await makeUser('alice'))
    const result = await createGroup({ name: 'Trip', currency: 'JPY' })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.group.count()).toBe(0)
  })
})

describe('renameGroup', () => {
  it('lets any member rename the group', async () => {
    const alice = await makeUser('alice')
    mockCurrentUser(alice)
    await createGroup({ name: 'Old', currency: 'USD' })
    const group = await prisma.group.findFirstOrThrow()

    const result = await renameGroup({ groupId: group.id, name: 'New' })
    expect(result.ok).toBe(true)
    expect((await prisma.group.findFirstOrThrow()).name).toBe('New')
  })

  it('refuses a non-member with a generic not-found error', async () => {
    mockCurrentUser(await makeUser('alice'))
    await createGroup({ name: 'Old', currency: 'USD' })
    const group = await prisma.group.findFirstOrThrow()

    mockCurrentUser(await makeUser('mallory'))
    const result = await renameGroup({ groupId: group.id, name: 'Hacked' })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect((await prisma.group.findFirstOrThrow()).name).toBe('Old')
  })
})
