import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { upsertUserFromClaims } from '@/lib/auth'
import { resetDb } from '../helpers/db'

beforeEach(resetDb)

describe('upsertUserFromClaims', () => {
  it('creates a user on first sight of an external id', async () => {
    const user = await upsertUserFromClaims({
      sub: 'auth0|123',
      name: 'Alice Example',
    })
    expect(user.externalId).toBe('auth0|123')
    expect(user.displayName).toBe('Alice Example')
    expect(await prisma.user.count()).toBe(1)
  })

  it('is idempotent for a repeat login', async () => {
    const first = await upsertUserFromClaims({ sub: 'auth0|123', name: 'Alice' })
    const second = await upsertUserFromClaims({ sub: 'auth0|123', name: 'Alice' })
    expect(second.id).toBe(first.id)
    expect(await prisma.user.count()).toBe(1)
  })

  it('falls back through nickname to the email local part', async () => {
    const nick = await upsertUserFromClaims({
      sub: 'auth0|nick',
      nickname: 'nickname-only',
    })
    expect(nick.displayName).toBe('nickname-only')

    const emailOnly = await upsertUserFromClaims({
      sub: 'auth0|mail',
      email: 'carol@example.com',
    })
    expect(emailOnly.displayName).toBe('carol')
  })

  it('uses a placeholder when no name claim is present at all', async () => {
    const user = await upsertUserFromClaims({ sub: 'auth0|bare' })
    expect(user.displayName).toBe('Member')
  })

  it('uses a placeholder when the email has an empty local part', async () => {
    const user = await upsertUserFromClaims({ sub: 'auth0|empty', email: '@x.com' })
    expect(user.displayName).toBe('Member')
  })

  it('treats a different external id as a different user', async () => {
    await upsertUserFromClaims({ sub: 'auth0|a', name: 'A' })
    await upsertUserFromClaims({ sub: 'sms|a', name: 'A' })
    expect(await prisma.user.count()).toBe(2)
  })
})
