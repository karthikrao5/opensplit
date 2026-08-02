import Link from 'next/link'
import { NewGroupDialog } from '@/components/new-group-dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import { Card, CardContent } from '@/components/ui/card'
import { requireUser } from '@/lib/auth'
import { computeBalances } from '@/lib/balances'
import { prisma } from '@/lib/db'
import { formatMoney } from '@/lib/money'

export default async function GroupsPage() {
  const user = await requireUser()

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: user.id } } },
    orderBy: { createdAt: 'desc' },
    include: {
      members: { select: { id: true, userId: true } },
      transactions: {
        select: {
          payerMemberId: true,
          amountMinor: true,
          splits: { select: { memberId: true, shareMinor: true } },
        },
      },
    },
  })

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your groups</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <NewGroupDialog />
        </div>
      </div>

      {groups.length === 0 && (
        <p className="text-muted-foreground">
          No groups yet. Create one to get started.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {groups.map((group) => {
          const memberIds = group.members.map((m) => m.id)
          const balances = computeBalances(memberIds, group.transactions)
          const mine = group.members.find((m) => m.userId === user.id)
          const net = mine ? (balances.get(mine.id) ?? 0) : 0

          return (
            <li key={group.id}>
              <Link href={`/groups/${group.id}`}>
                <Card className="transition-colors hover:bg-accent">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <span className="min-w-0 truncate font-medium">
                      {group.name}
                    </span>
                    <span
                      className={
                        'shrink-0 text-right ' +
                        (net > 0
                          ? 'text-emerald-600'
                          : net < 0
                            ? 'text-destructive'
                            : 'text-muted-foreground')
                      }
                    >
                      {net === 0
                        ? 'settled up'
                        : net > 0
                          ? `you are owed ${formatMoney(net, group.currency)}`
                          : `you owe ${formatMoney(-net, group.currency)}`}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
