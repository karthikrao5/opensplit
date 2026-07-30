'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
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

const claimSchema = z.object({ token: z.string().min(1) })

/**
 * Claims a placeholder member slot for the current user. Cannot use
 * requireMembership — the caller is not a member yet, which is the point.
 */
export async function claimMember(input: {
  token: string
}): Promise<ActionResult & { groupId?: string }> {
  let groupId: string | undefined

  const result = await runAction(async () => {
    const user = await requireUser()
    const parsed = claimSchema.safeParse(input)
    if (!parsed.success) throw new ValidationError('This invite link is not valid.')

    // The whole claim runs in one transaction, and the write is conditional on
    // the token still being present. Two users racing on the same link cannot
    // both win: under Read Committed the second updateMany re-evaluates its
    // WHERE against the row the first transaction committed — claimToken is now
    // null, so it matches nothing and is rejected as already-used.
    groupId = await prisma.$transaction(async (tx) => {
      const member = await tx.groupMember.findUnique({
        where: { claimToken: parsed.data.token },
      })
      if (!member) {
        throw new ValidationError(
          'This invite link is not valid or has already been used.',
        )
      }

      const existing = await tx.groupMember.findFirst({
        where: { groupId: member.groupId, userId: user.id },
      })
      if (existing) {
        throw new ValidationError(
          `You are already in this group as ${existing.displayName}.`,
        )
      }

      const claimed = await tx.groupMember.updateMany({
        where: { id: member.id, claimToken: parsed.data.token },
        data: { userId: user.id, claimToken: null },
      })
      if (claimed.count !== 1) {
        throw new ValidationError(
          'This invite link is not valid or has already been used.',
        )
      }
      return member.groupId
    })
  })

  if (result.ok && groupId) {
    revalidatePath('/groups')
    revalidatePath(`/groups/${groupId}`)
  }
  return { ...result, groupId }
}
