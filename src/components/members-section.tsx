'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { addPlaceholderMember, removeMember } from '@/lib/actions/members'

export type MemberRow = {
  id: string
  displayName: string
  isYou: boolean
  claimToken: string | null
}

export function MembersSection({
  groupId,
  members,
  baseUrl,
}: {
  groupId: string
  members: MemberRow[]
  baseUrl: string
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    setError(null)
    startTransition(async () => {
      const result = await addPlaceholderMember({ groupId, displayName: name })
      if (!result.ok) return setError(result.error)
      setName('')
    })
  }

  function remove(memberId: string) {
    setError(null)
    startTransition(async () => {
      const result = await removeMember({ groupId, memberId })
      if (!result.ok) setError(result.error)
    })
  }

  async function copyClaimLink(token: string) {
    await navigator.clipboard.writeText(`${baseUrl}/claim/${token}`)
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">
        Members ({members.length})
      </h2>

      <ul className="flex flex-col gap-2">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          >
            <span className="min-w-0 break-words">
              {member.displayName}
              {member.isYou && (
                <span className="text-muted-foreground"> (you)</span>
              )}
            </span>
            {member.claimToken && (
              <>
                <span className="text-xs text-muted-foreground">unclaimed</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => copyClaimLink(member.claimToken!)}
                >
                  {copied === member.claimToken ? 'Copied' : 'Copy invite link'}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto shrink-0 text-destructive"
              disabled={pending}
              onClick={() => remove(member.id)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <Separator />

      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a person"
          aria-label="New member name"
        />
        <Button onClick={add} disabled={pending || name.trim() === ''}>
          Add
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
