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
    claims.name ?? claims.nickname ?? claims.email?.split('@')[0] ?? 'Member'
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
  if (!user) redirect('/auth/login')
  return user
}
