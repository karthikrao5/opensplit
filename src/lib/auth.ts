import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { User } from '@prisma/client'
import { auth0 } from '@/lib/auth0'
import { prisma } from '@/lib/db'

export type UserClaims = {
  sub: string
  name?: string
  nickname?: string
  email?: string
}

function displayNameFrom(claims: UserClaims): string {
  return (
    claims.name ??
    claims.nickname ??
    (claims.email?.split('@')[0] || undefined) ??
    'Member'
  )
}

export async function upsertUserFromClaims(claims: UserClaims): Promise<User> {
  return prisma.user.upsert({
    where: { externalId: claims.sub },
    create: { externalId: claims.sub, displayName: displayNameFrom(claims) },
    update: {},
  })
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await auth0.getSession()
  if (!session?.user?.sub) return null
  return upsertUserFromClaims(session.user as UserClaims)
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) redirect(await loginUrl())
  return user
}

/**
 * Builds the Auth0 login URL, preserving where the user was headed via
 * `returnTo` so they land back there after authenticating (essential for deep
 * links like `/claim/<token>`). The current path is read from the `x-pathname`
 * header that `proxy.ts` forwards, since a Server Component cannot otherwise
 * see its own URL. The Auth0 SDK sanitizes `returnTo` against open redirects.
 */
async function loginUrl(): Promise<string> {
  const path = (await headers()).get('x-pathname')
  return path ? `/auth/login?returnTo=${encodeURIComponent(path)}` : '/auth/login'
}
