'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { claimMember } from '@/lib/actions/members'

/**
 * Two-step claim flow: an intro screen ("You've been invited…" + Join), then a
 * name screen where the claimer sets how they'll appear in the group. The
 * actual claim (and displayName) is written only on the final Join, so
 * abandoning the name step never consumes the token.
 */
export function ClaimFlow({
  token,
  groupName,
  invitedName,
}: {
  token: string
  groupName: string
  invitedName: string
}) {
  const router = useRouter()
  const [step, setStep] = useState<'intro' | 'name'>('intro')
  const [name, setName] = useState(invitedName)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function join() {
    setError(null)
    const displayName = name.trim()
    if (!displayName) return setError('Enter a name')

    startTransition(async () => {
      const result = await claimMember({ token, displayName })
      if (!result.ok) return setError(result.error)
      router.push(`/groups/${result.groupId}`)
    })
  }

  if (step === 'intro') {
    return (
      <main className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">
          You&apos;ve been invited as {invitedName}
        </h1>
        <p className="text-muted-foreground">in {groupName}</p>
        <Button onClick={() => setStep('name')}>Join group</Button>
      </main>
    )
  }

  return (
    <main className="flex flex-col items-start gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Choose your name</h1>
        <p className="text-muted-foreground">
          This is how you&apos;ll appear in {groupName}.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <Label htmlFor="claim-name">Your name</Label>
        <Input
          id="claim-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setError(null)
            setStep('intro')
          }}
          disabled={pending}
        >
          Back
        </Button>
        <Button onClick={join} disabled={pending || name.trim() === ''}>
          {pending ? 'Joining…' : 'Join group'}
        </Button>
      </div>
    </main>
  )
}
