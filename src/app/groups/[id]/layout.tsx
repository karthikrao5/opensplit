import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { GroupNav } from '@/components/group-nav'
import { HeaderAddTransaction } from '@/components/header-add-transaction'
import { Button } from '@/components/ui/button'
import { loadGroup } from './load-group'

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { you, group, members } = await loadGroup(id)

  return (
    // pb leaves room for the fixed bottom nav so content is never hidden behind it.
    <div className="flex flex-col gap-6 pb-24">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
            <Link href="/groups" aria-label="Back to groups">
              <ArrowLeftIcon />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{group.name}</h1>
            <p className="text-sm text-muted-foreground">{group.currency}</p>
          </div>
        </div>
        <HeaderAddTransaction
          groupId={group.id}
          currency={group.currency}
          members={members.map((m) => ({
            id: m.id,
            displayName: m.displayName,
          }))}
          defaultPayerId={you.id}
        />
      </header>
      {children}
      <GroupNav groupId={group.id} />
    </div>
  )
}
