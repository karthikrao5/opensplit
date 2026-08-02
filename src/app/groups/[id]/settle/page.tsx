import { BalanceSummary } from '@/components/balance-summary'
import {
  SettlementList,
  type SettlementRow,
} from '@/components/settlement-list'
import { computeBalances, suggestTransfers } from '@/lib/balances'
import { loadGroup, loadTransactions } from '../load-group'

export default async function GroupSettlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { you, group, members } = await loadGroup(id)
  const transactions = await loadTransactions(group.id)

  const memberIds = members.map((m) => m.id)
  const balances = computeBalances(memberIds, transactions)
  const transfers = suggestTransfers(balances)

  const nameOf = (memberId: string) =>
    members.find((m) => m.id === memberId)?.displayName ?? 'Unknown'

  const settlements: SettlementRow[] = transactions
    .filter((tx) => tx.kind === 'SETTLEMENT')
    .map((tx) => ({
      id: tx.id,
      fromName: nameOf(tx.payerMemberId),
      toName: tx.splits[0] ? nameOf(tx.splits[0].memberId) : 'Unknown',
      amountMinor: tx.amountMinor,
      occurredAt: tx.occurredAt,
    }))

  return (
    <div className="flex flex-col gap-6">
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
      <SettlementList
        groupId={group.id}
        currency={group.currency}
        settlements={settlements}
      />
    </div>
  )
}
