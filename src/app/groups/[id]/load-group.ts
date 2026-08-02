import { prisma } from '@/lib/db'
import { pageMembership } from '@/lib/membership'

/** Membership check + the group's members — shared by all group tab routes. */
export async function loadGroup(id: string) {
  const { user, member: you, group } = await pageMembership(id)
  const members = await prisma.groupMember.findMany({
    where: { groupId: group.id },
    orderBy: { createdAt: 'asc' },
  })
  return { user, you, group, members }
}

/** The group's transactions with splits — used by the transactions and settle tabs. */
export function loadTransactions(groupId: string) {
  return prisma.transaction.findMany({
    where: { groupId },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    include: { splits: true },
  })
}
