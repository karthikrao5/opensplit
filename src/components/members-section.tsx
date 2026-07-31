'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  addPlaceholderMember,
  removeMember,
  renameMember,
} from '@/lib/actions/members'

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

  // Rename-your-own-slot modal state.
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameMemberId, setRenameMemberId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)

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

  function openRename(member: MemberRow) {
    setRenameMemberId(member.id)
    setRenameValue(member.displayName)
    setRenameError(null)
    setRenameOpen(true)
  }

  function saveRename() {
    if (!renameMemberId) return
    setRenameError(null)
    const displayName = renameValue.trim()
    if (!displayName) return setRenameError('Enter a name')

    startTransition(async () => {
      const result = await renameMember({
        groupId,
        memberId: renameMemberId,
        displayName,
      })
      if (!result.ok) return setRenameError(result.error)
      setRenameOpen(false)
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
            {member.isYou ? (
              <button
                type="button"
                onClick={() => openRename(member)}
                className="min-w-0 break-words text-left hover:underline"
              >
                {member.displayName}
                <span className="text-muted-foreground"> (you)</span>
              </button>
            ) : (
              <span className="min-w-0 break-words">{member.displayName}</span>
            )}
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

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change your name</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-name">Your name in this group</Label>
            <Input
              id="member-name"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
            {renameError && (
              <p className="text-sm text-destructive">{renameError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={saveRename}
              disabled={pending || renameValue.trim() === ''}
            >
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
