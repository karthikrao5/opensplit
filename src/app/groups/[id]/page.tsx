import { AddTransactionDialog } from '@/components/add-transaction-dialog'
import {
  TransactionList,
  type TransactionRow,
} from '@/components/transaction-list'
import { loadGroup, loadTransactions } from './load-group'

export default async function GroupTransactionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { you, group, members } = await loadGroup(id)
  const transactions = await loadTransactions(group.id)

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

  const memberOptions = members.map((m) => ({
    id: m.id,
    displayName: m.displayName,
  }))

  return (
    <section className="flex flex-col gap-4">
      <TransactionList
        groupId={group.id}
        currency={group.currency}
        members={memberOptions}
        defaultPayerId={you.id}
        transactions={rows}
      />
      <div className="flex justify-center pt-2">
        <AddTransactionDialog
          groupId={group.id}
          currency={group.currency}
          members={memberOptions}
          defaultPayerId={you.id}
        />
      </div>
    </section>
  )
}
