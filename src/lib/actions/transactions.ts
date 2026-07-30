'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { runAction, ValidationError, type ActionResult } from '@/lib/action-result'
import { prisma } from '@/lib/db'
import {
  NotMemberError,
  requireGroupMemberIds,
  requireMembership,
} from '@/lib/membership'
import { MAX_AMOUNT_MINOR, splitEvenly } from '@/lib/money'

const amountSchema = z
  .number()
  .int('Amount must be a whole number of cents')
  .positive('Amount must be greater than zero')
  .max(MAX_AMOUNT_MINOR, 'Amount is too large')

const dateSchema = z.string().min(1).pipe(z.coerce.date())

const expenseSchema = z.object({
  groupId: z.string().uuid(),
  description: z.string().trim().min(1, 'Description is required').max(140),
  amountMinor: amountSchema,
  payerMemberId: z.string().uuid(),
  includedMemberIds: z
    .array(z.string().uuid())
    .min(1, 'Include at least one person in the split'),
  occurredAt: dateSchema,
})

type ExpenseInput = {
  groupId: string
  description: string
  amountMinor: number
  payerMemberId: string
  includedMemberIds: string[]
  occurredAt: string
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message)
  return parsed.data
}

/** Builds the split rows for an expense, verifying every member id first. */
async function buildSplits(
  groupId: string,
  amountMinor: number,
  payerMemberId: string,
  includedMemberIds: string[],
) {
  await requireGroupMemberIds(groupId, [payerMemberId, ...includedMemberIds])
  const shares = splitEvenly(amountMinor, [...new Set(includedMemberIds)])
  return [...shares].map(([memberId, shareMinor]) => ({ memberId, shareMinor }))
}

export async function addTransaction(input: ExpenseInput): Promise<ActionResult> {
  const result = await runAction(async () => {
    const data = parseOrThrow(expenseSchema, input)
    const { group } = await requireMembership(data.groupId)
    const splits = await buildSplits(
      group.id,
      data.amountMinor,
      data.payerMemberId,
      data.includedMemberIds,
    )

    await prisma.transaction.create({
      data: {
        groupId: group.id,
        kind: 'EXPENSE',
        description: data.description,
        amountMinor: data.amountMinor,
        payerMemberId: data.payerMemberId,
        occurredAt: data.occurredAt,
        splits: { create: splits },
      },
    })
  })

  if (result.ok) revalidatePath(`/groups/${input.groupId}`)
  return result
}

const updateSchema = expenseSchema.extend({
  transactionId: z.string().uuid(),
})

export async function updateTransaction(
  input: ExpenseInput & { transactionId: string },
): Promise<ActionResult> {
  const result = await runAction(async () => {
    const data = parseOrThrow(updateSchema, input)
    const { group } = await requireMembership(data.groupId)

    const existing = await prisma.transaction.findFirst({
      where: { id: data.transactionId, groupId: group.id },
    })
    if (!existing) throw new NotMemberError()

    const splits = await buildSplits(
      group.id,
      data.amountMinor,
      data.payerMemberId,
      data.includedMemberIds,
    )

    // Splits are replaced wholesale, never patched in place.
    await prisma.$transaction([
      prisma.transactionSplit.deleteMany({
        where: { transactionId: existing.id },
      }),
      prisma.transaction.update({
        where: { id: existing.id },
        data: {
          description: data.description,
          amountMinor: data.amountMinor,
          payerMemberId: data.payerMemberId,
          occurredAt: data.occurredAt,
          splits: { create: splits },
        },
      }),
    ])
  })

  if (result.ok) revalidatePath(`/groups/${input.groupId}`)
  return result
}

const deleteSchema = z.object({
  groupId: z.string().uuid(),
  transactionId: z.string().uuid(),
})

export async function deleteTransaction(input: {
  groupId: string
  transactionId: string
}): Promise<ActionResult> {
  const result = await runAction(async () => {
    const data = parseOrThrow(deleteSchema, input)
    const { group } = await requireMembership(data.groupId)

    const deleted = await prisma.transaction.deleteMany({
      where: { id: data.transactionId, groupId: group.id },
    })
    if (deleted.count === 0) throw new NotMemberError()
  })

  if (result.ok) revalidatePath(`/groups/${input.groupId}`)
  return result
}

const settlementSchema = z
  .object({
    groupId: z.string().uuid(),
    fromMemberId: z.string().uuid(),
    toMemberId: z.string().uuid(),
    amountMinor: amountSchema,
    occurredAt: dateSchema,
  })
  .refine((data) => data.fromMemberId !== data.toMemberId, {
    message: 'A settlement needs two different people',
  })

export async function recordSettlement(input: {
  groupId: string
  fromMemberId: string
  toMemberId: string
  amountMinor: number
  occurredAt: string
}): Promise<ActionResult> {
  const result = await runAction(async () => {
    const data = parseOrThrow(settlementSchema, input)
    const { group } = await requireMembership(data.groupId)
    await requireGroupMemberIds(group.id, [data.fromMemberId, data.toMemberId])

    await prisma.transaction.create({
      data: {
        groupId: group.id,
        kind: 'SETTLEMENT',
        description: 'Settlement',
        amountMinor: data.amountMinor,
        payerMemberId: data.fromMemberId,
        occurredAt: data.occurredAt,
        splits: {
          create: [{ memberId: data.toMemberId, shareMinor: data.amountMinor }],
        },
      },
    })
  })

  if (result.ok) revalidatePath(`/groups/${input.groupId}`)
  return result
}
