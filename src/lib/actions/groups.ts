'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { runAction, ValidationError, type ActionResult } from '@/lib/action-result'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { requireMembership } from '@/lib/membership'
import { CURRENCIES } from '@/lib/money'

const nameSchema = z.string().trim().min(1, 'Name is required').max(80)

const createGroupSchema = z.object({
  name: nameSchema,
  currency: z.enum(CURRENCIES),
})

export async function createGroup(input: {
  name: string
  currency: string
}): Promise<ActionResult & { groupId?: string }> {
  let groupId: string | undefined

  const result = await runAction(async () => {
    const user = await requireUser()
    const parsed = createGroupSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0].message)
    }

    const group = await prisma.group.create({
      data: {
        name: parsed.data.name,
        currency: parsed.data.currency,
        members: {
          create: [{ displayName: user.displayName, userId: user.id }],
        },
      },
    })
    groupId = group.id
  })

  if (result.ok) revalidatePath('/groups')
  return { ...result, groupId }
}

const renameGroupSchema = z.object({
  groupId: z.string().uuid(),
  name: nameSchema,
})

export async function renameGroup(input: {
  groupId: string
  name: string
}): Promise<ActionResult> {
  const result = await runAction(async () => {
    const parsed = renameGroupSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0].message)
    }
    const { group } = await requireMembership(parsed.data.groupId)
    await prisma.group.update({
      where: { id: group.id },
      data: { name: parsed.data.name },
    })
  })

  if (result.ok) {
    revalidatePath('/groups')
    revalidatePath(`/groups/${input.groupId}`)
  }
  return result
}
