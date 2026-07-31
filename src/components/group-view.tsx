'use client'

import { useState } from 'react'
import {
  ArrowLeftRightIcon,
  ReceiptIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import {
  AddTransactionDialog,
  type MemberOption,
} from '@/components/add-transaction-dialog'
import { BalanceSummary } from '@/components/balance-summary'
import { MembersSection, type MemberRow } from '@/components/members-section'
import {
  TransactionList,
  type TransactionRow,
} from '@/components/transaction-list'
import type { Transfer } from '@/lib/balances'
import { cn } from '@/lib/utils'

type Tab = 'transactions' | 'settle' | 'members'

const TABS: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: 'transactions', label: 'Transactions', Icon: ReceiptIcon },
  { id: 'settle', label: 'Settle up', Icon: ArrowLeftRightIcon },
  { id: 'members', label: 'Members', Icon: UsersIcon },
]

export function GroupView({
  groupId,
  groupName,
  currency,
  memberOptions,
  memberRows,
  balances,
  transfers,
  yourMemberId,
  defaultPayerId,
  transactions,
  baseUrl,
}: {
  groupId: string
  groupName: string
  currency: string
  memberOptions: MemberOption[]
  memberRows: MemberRow[]
  balances: { memberId: string; net: number }[]
  transfers: Transfer[]
  yourMemberId: string
  defaultPayerId: string
  transactions: TransactionRow[]
  baseUrl: string
}) {
  const [tab, setTab] = useState<Tab>('transactions')

  return (
    // pb leaves room for the fixed bottom nav so content is never hidden behind it.
    <div className="flex flex-col gap-6 pb-24">
      <header className="min-w-0">
        <h1 className="truncate text-2xl font-semibold">{groupName}</h1>
        <p className="text-sm text-muted-foreground">{currency}</p>
      </header>

      {tab === 'transactions' && (
        <section className="flex flex-col gap-4">
          <TransactionList
            groupId={groupId}
            currency={currency}
            members={memberOptions}
            defaultPayerId={defaultPayerId}
            transactions={transactions}
          />
          <div className="flex justify-center pt-2">
            <AddTransactionDialog
              groupId={groupId}
              currency={currency}
              members={memberOptions}
              defaultPayerId={defaultPayerId}
            />
          </div>
        </section>
      )}

      {tab === 'settle' && (
        <BalanceSummary
          groupId={groupId}
          currency={currency}
          members={memberOptions}
          balances={balances}
          transfers={transfers}
          yourMemberId={yourMemberId}
        />
      )}

      {tab === 'members' && (
        <MembersSection
          groupId={groupId}
          baseUrl={baseUrl}
          members={memberRows}
        />
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background">
        <div className="mx-auto flex max-w-2xl">
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs transition-colors',
                  active
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
