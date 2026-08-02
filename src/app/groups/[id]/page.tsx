import { GroupView } from '@/components/group-view'
import type { TransactionRow } from '@/components/transaction-list'
import { computeBalances, suggestTransfers } from '@/lib/balances'
import { prisma } from '@/lib/db'
import { pageMembership } from '@/lib/membership'

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { user, member: you, group } = await pageMembership(id)

  const members = await prisma.groupMember.findMany({
    where: { groupId: group.id },
    orderBy: { createdAt: 'asc' },
  })

  const transactions = await prisma.transaction.findMany({
    where: { groupId: group.id },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    include: { splits: true },
  })

  const memberIds = members.map((m) => m.id)
  const balances = computeBalances(memberIds, transactions)
  const transfers = suggestTransfers(balances)
  const nameOf = (memberId: string) =>
    members.find((m) => m.id === memberId)?.displayName ?? 'Unknown'

  const rows: TransactionRow[] = transactions.map((tx) => ({
    id: tx.id,
    kind: tx.kind,
    description: tx.description,
    amountMinor: tx.amountMinor,
    payerMemberId: tx.payerMemberId,
    includedMemberIds: tx.splits.map((s) => s.memberId),
    splitType: tx.splitType,
    percentages: tx.splits
      .filter((s) => s.percent !== null)
      .map((s) => ({ memberId: s.memberId, percent: s.percent as number })),
    amounts:
      tx.splitType === 'EXACT'
        ? tx.splits.map((s) => ({
            memberId: s.memberId,
            amountMinor: s.shareMinor,
          }))
        : [],
    payerName: nameOf(tx.payerMemberId),
    recipientName:
      tx.kind === 'SETTLEMENT' && tx.splits[0]
        ? nameOf(tx.splits[0].memberId)
        : null,
    splitCount: tx.splits.length,
    occurredAt: tx.occurredAt.toISOString().slice(0, 10),
  }))

  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000'

  return (
    <GroupView
      groupId={group.id}
      groupName={group.name}
      currency={group.currency}
      memberOptions={members.map((m) => ({
        id: m.id,
        displayName: m.displayName,
      }))}
      memberRows={members.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        isYou: m.userId === user.id,
        claimToken: m.claimToken,
      }))}
      balances={memberIds.map((memberId) => ({
        memberId,
        net: balances.get(memberId) ?? 0,
      }))}
      transfers={transfers}
      yourMemberId={you.id}
      defaultPayerId={you.id}
      transactions={rows}
      baseUrl={baseUrl}
    />
  )
}
