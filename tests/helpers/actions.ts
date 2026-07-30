import { vi } from 'vitest'
import type { User } from '@prisma/client'

/**
 * Server Actions and pages read the session through @/lib/auth. Tests swap
 * that module out so no browser session is needed. Every test file that
 * exercises an action needs this line at the top level:
 *
 *   vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)
 *
 * The factory must import dynamically: vi.mock is hoisted above the file's
 * own imports, so referencing an imported `authMock` binding directly throws
 * a "cannot access before initialization" error.
 */
let current: User | null = null

export function mockCurrentUser(user: User | null): void {
  current = user
}

export function currentMockUser(): User | null {
  return current
}

export const authMock = {
  getCurrentUser: async () => current,
  requireUser: async () => {
    if (!current) throw new Error('redirect(/auth/login)')
    return current
  },
  upsertUserFromClaims: async () => {
    throw new Error('not mocked')
  },
}
