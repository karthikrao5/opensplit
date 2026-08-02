import { GroupNav } from '@/components/group-nav'
import { pageMembership } from '@/lib/membership'

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { group } = await pageMembership(id)

  return (
    // pb leaves room for the fixed bottom nav so content is never hidden behind it.
    <div className="flex flex-col gap-6 pb-24">
      <header className="min-w-0">
        <h1 className="truncate text-2xl font-semibold">{group.name}</h1>
        <p className="text-sm text-muted-foreground">{group.currency}</p>
      </header>
      {children}
      <GroupNav groupId={group.id} />
    </div>
  )
}
