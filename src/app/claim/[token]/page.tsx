import { notFound } from 'next/navigation'
import { ClaimFlow } from './claim-flow'
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
    <ClaimFlow
      token={token}
      groupName={member.group.name}
      invitedName={member.displayName}
    />
  )
}
