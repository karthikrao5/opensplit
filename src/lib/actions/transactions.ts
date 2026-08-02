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
import {
  MAX_AMOUNT_MINOR,
  splitByAmounts,
  splitByPercentages,
  splitEvenly,
} from '@/lib/money'

const amountSchema = z
  .number()
  .int('Amount must be a whole number of cents')
  .positive('Amount must be greater than zero')
  .max(MAX_AMOUNT_MINOR, 'Amount is too large')

const dateSchema = z.string().min(1).pipe(z.coerce.date())

const percentageEntrySchema = z.object({
  memberId: z.string().uuid(),
  percent: z.number().int('Percent must be a whole number').min(0).max(100),
})

const exactEntrySchema = z.object({
  memberId: z.string().uuid(),
  shareMinor: z
    .number()
    .int('Amount must be a whole number of cents')
    .min(0)
    .max(MAX_AMOUNT_MINOR),
})

const baseExpenseFields = z.object({
  groupId: z.string().uuid(),
  description: z.string().trim().min(1, 'Description is required').max(140),
  amountMinor: amountSchema,
  payerMemberId: z.string().uuid(),
  occurredAt: dateSchema,
  splitType: z.enum(['EVEN', 'PERCENTAGE', 'EXACT']).default('EVEN'),
  includedMemberIds: z.array(z.string().uuid()).optional(),
  percentages: z.array(percentageEntrySchema).optional(),
  amounts: z.array(exactEntrySchema).optional(),
})

/**
 * Validates the split-style-specific fields: EVEN needs a non-empty member
 * list; PERCENTAGE needs percentages with unique members that sum to 100;
 * EXACT needs amounts with unique members that sum to the total.
 */
function refineSplit(
  data: z.infer<typeof baseExpenseFields>,
  ctx: z.RefinementCtx,
) {
  if (data.splitType === 'EVEN') {
    if (!data.includedMemberIds?.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['includedMemberIds'],
        message: 'Include at least one person in the split',
      })
    }
    return
  }
  if (data.splitType === 'PERCENTAGE') {
    const percentages = data.percentages ?? []
    if (percentages.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['percentages'],
        message: 'Include at least one person in the split',
      })
      return
    }
    const ids = percentages.map((p) => p.memberId)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['percentages'],
        message: 'Each person can only appear once',
      })
    }
    if (percentages.reduce((total, p) => total + p.percent, 0) !== 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['percentages'],
        message: 'Percentages must add up to 100',
      })
    }
    return
  }
  // EXACT
  const amounts = data.amounts ?? []
  if (amounts.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['amounts'],
      message: 'Include at least one person in the split',
    })
    return
  }
  const ids = amounts.map((a) => a.memberId)
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['amounts'],
      message: 'Each person can only appear once',
    })
  }
  if (amounts.reduce((total, a) => total + a.shareMinor, 0) !== data.amountMinor) {
    ctx.addIssue({
      code: 'custom',
      path: ['amounts'],
      message: 'Amounts must add up to the total',
    })
  }
}

const expenseSchema = baseExpenseFields.superRefine(refineSplit)

type SplitSpec =
  | { splitType: 'EVEN'; includedMemberIds: string[] }
  | {
      splitType: 'PERCENTAGE'
      percentages: { memberId: string; percent: number }[]
    }
  | {
      splitType: 'EXACT'
      amounts: { memberId: string; shareMinor: number }[]
    }

// Loose input shape mirroring the schema (splitType defaults to EVEN; the
// split fields are optional and cross-validated at runtime by refineSplit).
type ExpenseInput = {
  groupId: string
  description: string
  amountMinor: number
  payerMemberId: string
  occurredAt: string
  splitType?: 'EVEN' | 'PERCENTAGE' | 'EXACT'
  includedMemberIds?: string[]
  percentages?: { memberId: string; percent: number }[]
  amounts?: { memberId: string; shareMinor: number }[]
}

/** Narrows validated schema output to the SplitSpec buildSplits consumes. */
function toSplitSpec(data: z.infer<typeof baseExpenseFields>): SplitSpec {
  if (data.splitType === 'PERCENTAGE') {
    return { splitType: 'PERCENTAGE', percentages: data.percentages ?? [] }
  }
  if (data.splitType === 'EXACT') {
    return { splitType: 'EXACT', amounts: data.amounts ?? [] }
  }
  return { splitType: 'EVEN', includedMemberIds: data.includedMemberIds ?? [] }
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
  spec: SplitSpec,
): Promise<{ memberId: string; shareMinor: number; percent: number | null }[]> {
  if (spec.splitType === 'EVEN') {
    const memberIds = [...new Set(spec.includedMemberIds)]
    await requireGroupMemberIds(groupId, [payerMemberId, ...memberIds])
    const shares = splitEvenly(amountMinor, memberIds)
    return [...shares].map(([memberId, shareMinor]) => ({
      memberId,
      shareMinor,
      percent: null,
    }))
  }

  if (spec.splitType === 'PERCENTAGE') {
    // A member left at 0% is simply excluded (no split row for them).
    const entries = spec.percentages.filter((p) => p.percent > 0)
    await requireGroupMemberIds(groupId, [
      payerMemberId,
      ...entries.map((e) => e.memberId),
    ])
    const shares = splitByPercentages(amountMinor, entries)
    const percentOf = new Map(entries.map((e) => [e.memberId, e.percent]))
    return [...shares].map(([memberId, shareMinor]) => ({
      memberId,
      shareMinor,
      percent: percentOf.get(memberId) ?? null,
    }))
  }

  // EXACT — a member left at 0 is excluded.
  const entries = spec.amounts.filter((a) => a.shareMinor > 0)
  await requireGroupMemberIds(groupId, [
    payerMemberId,
    ...entries.map((e) => e.memberId),
  ])
  const shares = splitByAmounts(amountMinor, entries)
  return [...shares].map(([memberId, shareMinor]) => ({
    memberId,
    shareMinor,
    percent: null,
  }))
}

export async function addTransaction(input: ExpenseInput): Promise<ActionResult> {
  const result = await runAction(async () => {
    const data = parseOrThrow(expenseSchema, input)
    const { group } = await requireMembership(data.groupId)
    const splits = await buildSplits(
      group.id,
      data.amountMinor,
      data.payerMemberId,
      toSplitSpec(data),
    )

    await prisma.transaction.create({
      data: {
        groupId: group.id,
        kind: 'EXPENSE',
        description: data.description,
        amountMinor: data.amountMinor,
        payerMemberId: data.payerMemberId,
        occurredAt: data.occurredAt,
        splitType: data.splitType,
        splits: { create: splits },
      },
    })
  })

  if (result.ok) revalidatePath(`/groups/${input.groupId}`)
  return result
}

const updateSchema = baseExpenseFields
  .extend({ transactionId: z.string().uuid() })
  .superRefine(refineSplit)

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
      toSplitSpec(data),
    )

    // Splits are replaced wholesale, never patched in place. splitType is
    // rewritten alongside so it never desyncs from the stored percent values.
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
          splitType: data.splitType,
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
