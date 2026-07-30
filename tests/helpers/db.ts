import { prisma } from '@/lib/db'

/** Truncates every table. Called in beforeEach of each integration file. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "TransactionSplit", "Transaction", "GroupMember", "Group", "User" CASCADE',
  )
}
