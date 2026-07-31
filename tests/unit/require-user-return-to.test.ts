import { beforeEach, describe, expect, it, vi } from 'vitest'

// requireUser reads the session via @/lib/auth0 and the current path via
// next/headers, and redirects via next/navigation. Mock all three so we can
// assert the login URL (with returnTo) it builds without a browser or DB.
const getSession = vi.fn()
vi.mock('@/lib/auth0', () => ({ auth0: { getSession: () => getSession() } }))

let pathHeader: string | null = null
vi.mock('next/headers', () => ({
  headers: async () => new Headers(pathHeader ? { 'x-pathname': pathHeader } : {}),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

import { requireUser } from '@/lib/auth'

beforeEach(() => {
  getSession.mockReset()
  pathHeader = null
})

describe('requireUser returnTo', () => {
  it('redirects to login with the current path as returnTo', async () => {
    getSession.mockResolvedValue(null)
    pathHeader = '/groups/abc-123?tab=x'

    await expect(requireUser()).rejects.toThrow(
      `REDIRECT:/auth/login?returnTo=${encodeURIComponent('/groups/abc-123?tab=x')}`,
    )
  })

  it('redirects to bare login when no path header is present', async () => {
    getSession.mockResolvedValue(null)
    pathHeader = null

    await expect(requireUser()).rejects.toThrow(/^REDIRECT:\/auth\/login$/)
  })
})
