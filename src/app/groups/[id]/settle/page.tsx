import { BalanceSummary } from '@/components/balance-summary'
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

  return (
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
  )
}
