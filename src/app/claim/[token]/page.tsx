import { notFound } from 'next/navigation'
import { ClaimButton } from './claim-button'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  await requireUser()

  const member = await prisma.groupMember.findUnique({
    where: { claimToken: token },
    include: { group: true },
  })
  if (!member) notFound()

  return (
    <main className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold">
        You&apos;ve been invited as {member.displayName}
      </h1>
      <p className="text-muted-foreground">in {member.group.name}</p>
      <ClaimButton token={token} />
    </main>
  )
}
