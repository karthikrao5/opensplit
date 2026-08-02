'use client'

import { usePathname } from 'next/navigation'
import {
  AddTransactionDialog,
  type MemberOption,
} from '@/components/add-transaction-dialog'

/** The header "Add transaction" button — hidden on the group's Settle tab. */
export function HeaderAddTransaction({
  groupId,
  currency,
  members,
  defaultPayerId,
}: {
  groupId: string
  currency: string
  members: MemberOption[]
  defaultPayerId: string
}) {
  const pathname = usePathname()
  if (pathname === `/groups/${groupId}/settle`) return null

  return (
    <AddTransactionDialog
      groupId={groupId}
      currency={currency}
      members={members}
      defaultPayerId={defaultPayerId}
    />
  )
}
