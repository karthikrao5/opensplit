import { AddTransactionDialog } from '@/components/add-transaction-dialog'
import { BalanceSummary } from '@/components/balance-summary'
import { MembersSection } from '@/components/members-section'
import { TransactionList, type TransactionRow } from '@/components/transaction-list'
import { Separator } from '@/components/ui/separator'
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
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold">{group.name}</h1>
          <p className="text-sm text-muted-foreground">{group.currency}</p>
        </div>
        <AddTransactionDialog
          groupId={group.id}
          currency={group.currency}
          members={members.map((m) => ({ id: m.id, displayName: m.displayName }))}
          defaultPayerId={you.id}
        />
      </div>

      <Separator />

      <BalanceSummary
        groupId={group.id}
        currency={group.currency}
        members={members.map((m) => ({ id: m.id, displayName: m.displayName }))}
        balances={memberIds.map((memberId) => ({
          memberId,
          net: balances.get(memberId) ?? 0,
        }))}
        transfers={transfers}
        yourMemberId={you.id}
      />

      <Separator />

      <MembersSection
        groupId={group.id}
        baseUrl={baseUrl}
        members={members.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          isYou: m.userId === user.id,
          claimToken: m.claimToken,
        }))}
      />

      <Separator />

      <TransactionList
        groupId={group.id}
        currency={group.currency}
        transactions={rows}
      />
    </main>
  )
}
