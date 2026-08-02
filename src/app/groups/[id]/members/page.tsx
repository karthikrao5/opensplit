import { MembersSection } from '@/components/members-section'
import { loadGroup } from '../load-group'

export default async function GroupMembersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { user, group, members } = await loadGroup(id)
  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000'

  return (
    <MembersSection
      groupId={group.id}
      baseUrl={baseUrl}
      members={members.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        isYou: m.userId === user.id,
        claimToken: m.claimToken,
      }))}
    />
  )
}
