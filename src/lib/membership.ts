import { notFound } from 'next/navigation'
import type { Group, GroupMember, User } from '@prisma/client'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * Raised when the current user is not a claimed member of the group, or the
 * group does not exist. Callers must not distinguish the two cases: pages turn
 * this into notFound(), actions into { ok: false, error: 'Not found' }.
 */
export class NotMemberError extends Error {
  constructor() {
    super('Not found')
    this.name = 'NotMemberError'
  }
}

export async function requireMembership(groupId: string): Promise<{
  user: User
  member: GroupMember
  group: Group
}> {
  const user = await requireUser()
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId: user.id },
    include: { group: true },
  })
  if (!member) throw new NotMemberError()

  const { group, ...memberRow } = member
  return { user, member: memberRow, group }
}

/** Verifies every supplied member id belongs to this group. */
export async function requireGroupMemberIds(
  groupId: string,
  memberIds: string[],
): Promise<void> {
  const unique = [...new Set(memberIds)]
  if (unique.length === 0) return

  const found = await prisma.groupMember.count({
    where: { groupId, id: { in: unique } },
  })
  if (found !== unique.length) throw new NotMemberError()
}

/** requireMembership for use in a page: renders the 404 page instead of throwing. */
export async function pageMembership(groupId: string) {
  try {
    return await requireMembership(groupId)
  } catch (error) {
    if (error instanceof NotMemberError) notFound()
    throw error
  }
}
