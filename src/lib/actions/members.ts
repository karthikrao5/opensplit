'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { runAction, ValidationError, type ActionResult } from '@/lib/action-result'
import { prisma } from '@/lib/db'
import { requireGroupMemberIds, requireMembership } from '@/lib/membership'

export function newClaimToken(): string {
  return randomBytes(24).toString('base64url')
}

const addSchema = z.object({
  groupId: z.string().uuid(),
  displayName: z.string().trim().min(1, 'Name is required').max(80),
})

export async function addPlaceholderMember(input: {
  groupId: string
  displayName: string
}): Promise<ActionResult> {
  const result = await runAction(async () => {
    const parsed = addSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0].message)
    }
    const { group } = await requireMembership(parsed.data.groupId)

    await prisma.groupMember.create({
      data: {
        groupId: group.id,
        displayName: parsed.data.displayName,
        claimToken: newClaimToken(),
      },
    })
  })

  if (result.ok) revalidatePath(`/groups/${input.groupId}`)
  return result
}

const removeSchema = z.object({
  groupId: z.string().uuid(),
  memberId: z.string().uuid(),
})

export async function removeMember(input: {
  groupId: string
  memberId: string
}): Promise<ActionResult> {
  const result = await runAction(async () => {
    const parsed = removeSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0].message)
    }
    const { group } = await requireMembership(parsed.data.groupId)
    await requireGroupMemberIds(group.id, [parsed.data.memberId])

    // Removing someone who appears in any transaction would corrupt every
    // balance in the group, so refuse rather than cascade.
    const paid = await prisma.transaction.count({
      where: { payerMemberId: parsed.data.memberId },
    })
    const owed = await prisma.transactionSplit.count({
      where: { memberId: parsed.data.memberId },
    })
    if (paid > 0 || owed > 0) {
      throw new ValidationError(
        'This person appears in existing transactions and cannot be removed.',
      )
    }

    await prisma.groupMember.delete({ where: { id: parsed.data.memberId } })
  })

  if (result.ok) revalidatePath(`/groups/${input.groupId}`)
  return result
}
