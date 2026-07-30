'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { claimMember } from '@/lib/actions/members'

export function ClaimButton({ token }: { token: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function claim() {
    setError(null)
    startTransition(async () => {
      const result = await claimMember({ token })
      if (!result.ok) return setError(result.error)
      router.push(`/groups/${result.groupId}`)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={claim} disabled={pending}>
        {pending ? 'Joining…' : 'Join group'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
