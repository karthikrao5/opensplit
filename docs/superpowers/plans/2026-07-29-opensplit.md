# OpenSplit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app where users create groups, add members, record expenses split evenly among a chosen subset, and see balances plus suggested settlement transfers.

**Architecture:** Next.js App Router. Pages are async Server Components querying Prisma directly; mutations are Server Actions. All money logic lives in pure, database-free modules (`lib/money.ts`, `lib/balances.ts`) that are unit-tested without infrastructure. Auth0 is confined to two files so it can be swapped for SMS OTP later. Authorization is a single question — "is this user a member of this group?" — answered by one helper every page and action calls first.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind + shadcn/ui, PostgreSQL via Prisma 6, `@auth0/nextjs-auth0` v4, Zod, Vitest.

Source spec: `docs/superpowers/specs/2026-07-29-opensplit-design.md`

## Operator prerequisites

Most of this plan runs unattended, but four points need a human. An executing
agent must stop at each and not proceed until the operator has acted or
confirmed.

**Setup (blocking):**

- **S1 — Local Postgres (before Task 3 Step 4).** A Postgres server must be
  running and reachable at the `.env` `DATABASE_URL`. The plan runs
  `createdb opensplit` / `opensplit_test`; providing the server is the
  operator's job.
- **S2 — Auth0 tenant (Task 4 Step 2).** Create a Regular Web Application,
  enable the Username-Password connection, set the callback and logout URLs,
  and fill `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`,
  `AUTH0_SECRET`, and `APP_BASE_URL` in `.env`.

Deployment (Vercel + managed Postgres) is out of scope for this plan.

**Verification gates (🛑 — stop and wait for operator confirmation):**

- **V1 — Task 4 Step 9:** the login round trip.
- **V2 — Task 8 Step 6:** the full invite loop.
- **V3 — Task 10 Step 7:** the full app flow.

**Runs unattended:** Tasks 1, 2, 5, 6, 7, and 9 need no operator involvement
(pure logic plus integration tests against the Postgres from S1). Tasks 3, 4,
8, and 10 contain the touchpoints above.

## Global Constraints

Every task's requirements implicitly include this section.

- **Money is integers in minor units.** No floats in the money path. Field names carry the unit: `amountMinor`, `shareMinor`.
- **Minor-unit exponent is assumed to be 2.** The currency picker is therefore limited to `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `INR`. Zero-decimal currencies (JPY, KRW) are out of scope.
- **`MAX_AMOUNT_MINOR = 1_000_000_000`.** Defined once in `lib/money.ts`; every amount validator references it.
- **One currency per group,** chosen at creation, never edited. No conversion.
- **Permissions are flat.** Any claimed member of a group may add/edit/delete any transaction, add and remove members, and rename the group. The only check is membership.
- **Never trust a `memberId` from the client.** Every member reference in an action's input is looked up with `where: { id, groupId }`.
- **Non-member and missing-group are indistinguishable.** Pages call `notFound()`; actions return `{ ok: false, error: 'Not found' }`.
- **Splits are stored, never derived at read time.** `sum(shareMinor) === amountMinor` for every transaction.
- **`shareMinor >= 0`.** A share is zero when the amount is smaller than the member count.
- **Actions return `ActionResult`,** never throw at the user.
- **Node 20+.** `npm` as the package manager.
- **Path alias `@/*` maps to `src/*`.**
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `chore:`).

---

## File Structure

```
prisma/
  schema.prisma                  Five models, enum TransactionKind
src/
  lib/
    money.ts                     splitEvenly, formatMoney, MAX_AMOUNT_MINOR, CURRENCIES
    balances.ts                  computeBalances, suggestTransfers
    db.ts                        Prisma client singleton
    auth0.ts                     Auth0Client instance — the SDK touches nothing else
    auth.ts                      getCurrentUser, requireUser, upsertUserFromClaims
    membership.ts                NotMemberError, requireMembership
    action-result.ts             ActionResult type, runAction wrapper
    actions/
      groups.ts                  createGroup, renameGroup
      members.ts                 addPlaceholderMember, removeMember, claimMember
      transactions.ts            addTransaction, updateTransaction,
                                 deleteTransaction, recordSettlement
  components/
    ui/                          shadcn generated components
    new-group-dialog.tsx
    members-section.tsx
    add-transaction-dialog.tsx
    settlement-dialog.tsx
    transaction-list.tsx
    balance-summary.tsx
  app/
    layout.tsx                   Root layout
    page.tsx                     Landing / redirect
    groups/page.tsx              Group list
    groups/[id]/page.tsx         Main screen
    claim/[token]/page.tsx       Claim a placeholder member
  middleware.ts                  Auth0 v4 route mounting
tests/
  helpers/db.ts                  resetDb() truncation helper
  helpers/actions.ts             mockCurrentUser() for action tests
  unit/money.test.ts
  unit/balances.test.ts
  integration/schema.test.ts
  integration/auth.test.ts
  integration/membership.test.ts
  integration/groups.test.ts
  integration/members.test.ts
  integration/claim.test.ts
  integration/transactions.test.ts
```

Tasks 1–2 deliver all the logic that can be numerically wrong, with zero infrastructure. Task 3 brings up the database. Tasks 4–5 build the two boundaries every later task depends on. Tasks 6–10 are vertical slices, each one action module plus the UI that calls it.

---

### Task 1: Project scaffold and money math

Scaffolding is folded in here because `splitEvenly` is the first thing worth testing and it needs a test runner to exist.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `components.json`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (all via scaffolding tools)
- Create: `vitest.config.ts`
- Create: `src/lib/money.ts`
- Test: `tests/unit/money.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_AMOUNT_MINOR: 1_000_000_000`
  - `CURRENCIES: readonly ['USD','EUR','GBP','CAD','AUD','INR']`
  - `type Currency = (typeof CURRENCIES)[number]`
  - `splitEvenly(amountMinor: number, memberIds: string[]): Map<string, number>`
  - `formatMoney(amountMinor: number, currency: string): string`

- [ ] **Step 1: Scaffold the Next.js app in the current directory**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm --no-turbopack --yes
```

The repo already contains `docs/` and `.claude/`; answer yes if it warns about a non-empty directory. Verify afterwards that `src/app/page.tsx` and `tsconfig.json` exist.

- [ ] **Step 2: Initialize shadcn/ui and add the components used later**

```bash
npx shadcn@latest init --yes --base-color slate
npx shadcn@latest add button card dialog input label select checkbox separator --yes
```

- [ ] **Step 3: Install test and runtime dependencies**

```bash
npm install zod
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths dotenv
```

- [ ] **Step 4: Add the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
```

Add scripts to `package.json`:

```json
"test": "vitest run --config vitest.config.ts",
"test:watch": "vitest --config vitest.config.ts"
```

- [ ] **Step 5: Write the failing tests**

Create `tests/unit/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatMoney, splitEvenly } from '@/lib/money'

const sum = (shares: Map<string, number>) =>
  [...shares.values()].reduce((a, b) => a + b, 0)

describe('splitEvenly', () => {
  it('divides an evenly divisible amount', () => {
    const shares = splitEvenly(900, ['a', 'b', 'c'])
    expect([...shares.values()]).toEqual([300, 300, 300])
  })

  it('distributes the remainder one minor unit at a time', () => {
    const shares = splitEvenly(1000, ['a', 'b', 'c'])
    expect(shares.get('a')).toBe(334)
    expect(shares.get('b')).toBe(333)
    expect(shares.get('c')).toBe(333)
  })

  it('always sums to the exact amount', () => {
    for (const amount of [1, 2, 7, 10, 99, 100, 101, 12345, 1_000_000_000]) {
      for (const n of [1, 2, 3, 5, 7, 11]) {
        const ids = Array.from({ length: n }, (_, i) => `m${i}`)
        expect(sum(splitEvenly(amount, ids))).toBe(amount)
      }
    }
  })

  it('gives zero shares when the amount is smaller than the member count', () => {
    const shares = splitEvenly(1, ['a', 'b', 'c', 'd', 'e'])
    expect(sum(shares)).toBe(1)
    expect([...shares.values()].filter((v) => v === 0)).toHaveLength(4)
  })

  it('is deterministic regardless of input ordering', () => {
    const forward = splitEvenly(1000, ['a', 'b', 'c'])
    const reversed = splitEvenly(1000, ['c', 'b', 'a'])
    expect([...reversed.entries()].sort()).toEqual([...forward.entries()].sort())
  })

  it('rejects an empty member list', () => {
    expect(() => splitEvenly(100, [])).toThrow(/at least one member/)
  })

  it('rejects a non-positive or non-integer amount', () => {
    expect(() => splitEvenly(0, ['a'])).toThrow(/positive integer/)
    expect(() => splitEvenly(-5, ['a'])).toThrow(/positive integer/)
    expect(() => splitEvenly(1.5, ['a'])).toThrow(/positive integer/)
  })
})

describe('formatMoney', () => {
  it('renders minor units as a currency string', () => {
    expect(formatMoney(4250, 'USD')).toBe('$42.50')
    expect(formatMoney(0, 'USD')).toBe('$0.00')
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/money`.

- [ ] **Step 7: Write the implementation**

Create `src/lib/money.ts`:

```ts
export const MAX_AMOUNT_MINOR = 1_000_000_000

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR'] as const
export type Currency = (typeof CURRENCIES)[number]

/**
 * Divides amountMinor across memberIds. Every member receives
 * floor(amount / n); the remainder is handed out one minor unit at a time to
 * members in id order, so the shares always sum to exactly amountMinor.
 */
export function splitEvenly(
  amountMinor: number,
  memberIds: string[],
): Map<string, number> {
  if (memberIds.length === 0) {
    throw new Error('splitEvenly requires at least one member')
  }
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('splitEvenly requires amountMinor to be a positive integer')
  }

  const ordered = [...memberIds].sort()
  const base = Math.floor(amountMinor / ordered.length)
  let remainder = amountMinor - base * ordered.length

  const shares = new Map<string, number>()
  for (const id of ordered) {
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    shares.set(id, base + extra)
  }
  return shares
}

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amountMinor / 100)
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app and add money splitting logic"
```

---

### Task 2: Balances and settlement suggestions

**Files:**
- Create: `src/lib/balances.ts`
- Test: `tests/unit/balances.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no import from Task 1).
- Produces:
  - `type BalanceTransaction = { payerMemberId: string; amountMinor: number; splits: { memberId: string; shareMinor: number }[] }`
  - `type Transfer = { fromMemberId: string; toMemberId: string; amountMinor: number }`
  - `computeBalances(memberIds: string[], transactions: BalanceTransaction[]): Map<string, number>`
  - `suggestTransfers(balances: Map<string, number>): Transfer[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/balances.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  computeBalances,
  suggestTransfers,
  type BalanceTransaction,
} from '@/lib/balances'

const dinner: BalanceTransaction = {
  payerMemberId: 'alice',
  amountMinor: 7650,
  splits: [
    { memberId: 'alice', shareMinor: 2550 },
    { memberId: 'bob', shareMinor: 2550 },
    { memberId: 'carol', shareMinor: 2550 },
  ],
}

describe('computeBalances', () => {
  it('credits the payer and debits each split target', () => {
    const balances = computeBalances(['alice', 'bob', 'carol'], [dinner])
    expect(balances.get('alice')).toBe(5100)
    expect(balances.get('bob')).toBe(-2550)
    expect(balances.get('carol')).toBe(-2550)
  })

  it('includes members with no activity at zero', () => {
    const balances = computeBalances(['alice', 'bob', 'carol', 'dave'], [dinner])
    expect(balances.get('dave')).toBe(0)
  })

  it('always sums to zero', () => {
    const taxi: BalanceTransaction = {
      payerMemberId: 'bob',
      amountMinor: 1200,
      splits: [
        { memberId: 'bob', shareMinor: 600 },
        { memberId: 'carol', shareMinor: 600 },
      ],
    }
    const balances = computeBalances(['alice', 'bob', 'carol'], [dinner, taxi])
    const total = [...balances.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(0)
  })

  it('treats a settlement as an ordinary transaction that offsets balances', () => {
    const settlement: BalanceTransaction = {
      payerMemberId: 'bob',
      amountMinor: 2550,
      splits: [{ memberId: 'alice', shareMinor: 2550 }],
    }
    const balances = computeBalances(
      ['alice', 'bob', 'carol'],
      [dinner, settlement],
    )
    expect(balances.get('bob')).toBe(0)
    expect(balances.get('alice')).toBe(2550)
  })

  it('returns all zeros when there are no transactions', () => {
    const balances = computeBalances(['alice', 'bob'], [])
    expect([...balances.values()]).toEqual([0, 0])
  })
})

const applyTransfers = (
  balances: Map<string, number>,
  transfers: { fromMemberId: string; toMemberId: string; amountMinor: number }[],
) => {
  const result = new Map(balances)
  for (const t of transfers) {
    result.set(t.fromMemberId, (result.get(t.fromMemberId) ?? 0) + t.amountMinor)
    result.set(t.toMemberId, (result.get(t.toMemberId) ?? 0) - t.amountMinor)
  }
  return result
}

describe('suggestTransfers', () => {
  it('zeroes every balance', () => {
    const balances = new Map([
      ['alice', 4250],
      ['bob', -1700],
      ['carol', -2550],
    ])
    const settled = applyTransfers(balances, suggestTransfers(balances))
    expect([...settled.values()].every((v) => v === 0)).toBe(true)
  })

  it('emits at most n-1 transfers', () => {
    const balances = new Map([
      ['a', 5000],
      ['b', 3000],
      ['c', -2000],
      ['d', -2500],
      ['e', -3500],
    ])
    expect(suggestTransfers(balances).length).toBeLessThanOrEqual(4)
  })

  it('splits one debtor across two creditors when needed', () => {
    const balances = new Map([
      ['debtor', -3000],
      ['big', 2000],
      ['small', 1000],
    ])
    const transfers = suggestTransfers(balances)
    expect(transfers).toEqual([
      { fromMemberId: 'debtor', toMemberId: 'big', amountMinor: 2000 },
      { fromMemberId: 'debtor', toMemberId: 'small', amountMinor: 1000 },
    ])
  })

  it('returns nothing when everyone is square', () => {
    expect(suggestTransfers(new Map([['a', 0], ['b', 0]]))).toEqual([])
  })

  it('never emits a zero-amount transfer', () => {
    const balances = new Map([['a', 100], ['b', -100], ['c', 0]])
    expect(suggestTransfers(balances).every((t) => t.amountMinor > 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/balances`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/balances.ts`:

```ts
export type BalanceTransaction = {
  payerMemberId: string
  amountMinor: number
  splits: { memberId: string; shareMinor: number }[]
}

export type Transfer = {
  fromMemberId: string
  toMemberId: string
  amountMinor: number
}

/**
 * Net position per member: what they paid out, minus what they owe.
 * Positive means the group owes them. Always sums to zero.
 */
export function computeBalances(
  memberIds: string[],
  transactions: BalanceTransaction[],
): Map<string, number> {
  const balances = new Map<string, number>(memberIds.map((id) => [id, 0]))
  const add = (id: string, delta: number) =>
    balances.set(id, (balances.get(id) ?? 0) + delta)

  for (const tx of transactions) {
    add(tx.payerMemberId, tx.amountMinor)
    for (const split of tx.splits) add(split.memberId, -split.shareMinor)
  }
  return balances
}

/**
 * Greedy minimum-cash-flow: repeatedly match the largest debtor against the
 * largest creditor and transfer the smaller of the two amounts.
 *
 * Not provably minimal in every case — the general problem is NP-hard — but
 * optimal in practice at the group sizes this app targets, and it emits at
 * most n-1 transfers. This is intentional, not a placeholder.
 */
export function suggestTransfers(balances: Map<string, number>): Transfer[] {
  const byMagnitudeThenId = (
    a: { id: string; amount: number },
    b: { id: string; amount: number },
  ) => b.amount - a.amount || a.id.localeCompare(b.id)

  const debtors = [...balances]
    .filter(([, net]) => net < 0)
    .map(([id, net]) => ({ id, amount: -net }))
    .sort(byMagnitudeThenId)

  const creditors = [...balances]
    .filter(([, net]) => net > 0)
    .map(([id, net]) => ({ id, amount: net }))
    .sort(byMagnitudeThenId)

  const transfers: Transfer[] = []
  let d = 0
  let c = 0

  while (d < debtors.length && c < creditors.length) {
    const amountMinor = Math.min(debtors[d].amount, creditors[c].amount)
    transfers.push({
      fromMemberId: debtors[d].id,
      toMemberId: creditors[c].id,
      amountMinor,
    })
    debtors[d].amount -= amountMinor
    creditors[c].amount -= amountMinor
    if (debtors[d].amount === 0) d++
    if (creditors[c].amount === 0) c++
  }

  return transfers
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 18 tests total across both unit files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add balance computation and settlement suggestions"
```

---

### Task 3: Database schema and integration test harness

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/db.ts`
- Create: `vitest.integration.config.ts`
- Create: `tests/helpers/db.ts`
- Create: `.env.example`, `.env.test`
- Modify: `.gitignore` (add `.env`, `.env.test`, keep `.env.example` tracked)
- Modify: `package.json` (scripts)
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `prisma` — the `PrismaClient` singleton exported from `@/lib/db`
  - Prisma model types `User`, `Group`, `GroupMember`, `Transaction`, `TransactionSplit`, enum `TransactionKind` with values `EXPENSE` and `SETTLEMENT`
  - `resetDb(): Promise<void>` from `tests/helpers/db`

- [ ] **Step 1: Install Prisma and create the schema**

```bash
npm install @prisma/client
npm install -D prisma
```

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum TransactionKind {
  EXPENSE
  SETTLEMENT
}

model User {
  id          String   @id @default(uuid())
  externalId  String   @unique
  displayName String
  createdAt   DateTime @default(now())

  memberships GroupMember[]
}

model Group {
  id        String   @id @default(uuid())
  name      String
  currency  String
  createdAt DateTime @default(now())

  members      GroupMember[]
  transactions Transaction[]
}

model GroupMember {
  id          String   @id @default(uuid())
  groupId     String
  displayName String
  userId      String?
  claimToken  String?  @unique
  createdAt   DateTime @default(now())

  group        Group              @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user         User?              @relation(fields: [userId], references: [id])
  paid         Transaction[]      @relation("payer")
  splits       TransactionSplit[]

  @@unique([groupId, userId])
  @@index([groupId])
}

model Transaction {
  id            String          @id @default(uuid())
  groupId       String
  kind          TransactionKind
  description   String
  amountMinor   Int
  payerMemberId String
  occurredAt    DateTime
  createdAt     DateTime        @default(now())

  group  Group              @relation(fields: [groupId], references: [id], onDelete: Cascade)
  payer  GroupMember        @relation("payer", fields: [payerMemberId], references: [id])
  splits TransactionSplit[]

  @@index([groupId, occurredAt])
}

model TransactionSplit {
  id            String @id @default(uuid())
  transactionId String
  memberId      String
  shareMinor    Int

  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  member      GroupMember @relation(fields: [memberId], references: [id])

  @@unique([transactionId, memberId])
  @@index([transactionId])
}
```

Note on `@@unique([groupId, userId])`: Postgres treats NULLs as distinct, so this permits many placeholder members per group while allowing each user at most one claimed slot. That is exactly the intent.

- [ ] **Step 2: Set up environment files**

Create `.env.example`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/opensplit?schema=public"

AUTH0_DOMAIN="your-tenant.us.auth0.com"
AUTH0_CLIENT_ID=""
AUTH0_CLIENT_SECRET=""
AUTH0_SECRET=""
APP_BASE_URL="http://localhost:3000"
```

Create `.env` as a copy with a real local `DATABASE_URL` (Auth0 values are filled in during Task 4).

Create `.env.test` with a **separate database name** — integration tests truncate every table:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/opensplit_test?schema=public"
```

Append to `.gitignore`:

```
.env
.env.test
```

- [ ] **Step 3: Create the Prisma client singleton**

Create `src/lib/db.ts`:

```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 4: Run the migration against both databases**

```bash
createdb opensplit || true
createdb opensplit_test || true
npx prisma migrate dev --name init
DATABASE_URL="$(grep DATABASE_URL .env.test | cut -d'"' -f2)" npx prisma migrate deploy
```

Add to `package.json` scripts:

```json
"db:migrate": "prisma migrate dev",
"db:reset:test": "dotenv -e .env.test -- prisma migrate reset --force",
"test:integration": "vitest run --config vitest.integration.config.ts",
"test:all": "npm test && npm run test:integration"
```

- [ ] **Step 5: Add the integration test config and truncation helper**

Create `vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { config } from 'dotenv'

config({ path: '.env.test', override: true })

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
  },
})
```

`fileParallelism: false` matters: all files share one database and truncate it, so they must not run concurrently.

Create `tests/helpers/db.ts`:

```ts
import { prisma } from '@/lib/db'

/** Truncates every table. Called in beforeEach of each integration file. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "TransactionSplit", "Transaction", "GroupMember", "Group", "User" CASCADE',
  )
}
```

- [ ] **Step 6: Write the failing schema test**

Create `tests/integration/schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../helpers/db'

beforeEach(resetDb)

describe('schema', () => {
  it('stores a group with a claimed and a placeholder member', async () => {
    const user = await prisma.user.create({
      data: { externalId: 'auth0|alice', displayName: 'Alice' },
    })
    const group = await prisma.group.create({
      data: {
        name: 'Trip to Lisbon',
        currency: 'USD',
        members: {
          create: [
            { displayName: 'Alice', userId: user.id },
            { displayName: 'Bob', claimToken: 'tok-bob' },
          ],
        },
      },
      include: { members: true },
    })

    expect(group.members).toHaveLength(2)
    expect(group.members.filter((m) => m.userId === null)).toHaveLength(1)
  })

  it('allows many placeholder members in one group', async () => {
    const group = await prisma.group.create({ data: { name: 'G', currency: 'USD' } })
    await prisma.groupMember.create({
      data: { groupId: group.id, displayName: 'Bob', claimToken: 't1' },
    })
    await prisma.groupMember.create({
      data: { groupId: group.id, displayName: 'Carol', claimToken: 't2' },
    })
    expect(await prisma.groupMember.count({ where: { groupId: group.id } })).toBe(2)
  })

  it('refuses two memberships for the same user in one group', async () => {
    const user = await prisma.user.create({
      data: { externalId: 'auth0|dup', displayName: 'Dup' },
    })
    const group = await prisma.group.create({ data: { name: 'G', currency: 'USD' } })
    await prisma.groupMember.create({
      data: { groupId: group.id, displayName: 'One', userId: user.id },
    })

    await expect(
      prisma.groupMember.create({
        data: { groupId: group.id, displayName: 'Two', userId: user.id },
      }),
    ).rejects.toThrow()
  })

  it('cascades split deletion when a transaction is deleted', async () => {
    const group = await prisma.group.create({ data: { name: 'G', currency: 'USD' } })
    const member = await prisma.groupMember.create({
      data: { groupId: group.id, displayName: 'Solo', claimToken: 't' },
    })
    const tx = await prisma.transaction.create({
      data: {
        groupId: group.id,
        kind: 'EXPENSE',
        description: 'Lunch',
        amountMinor: 500,
        payerMemberId: member.id,
        occurredAt: new Date('2026-07-28'),
        splits: { create: [{ memberId: member.id, shareMinor: 500 }] },
      },
    })

    await prisma.transaction.delete({ where: { id: tx.id } })
    expect(await prisma.transactionSplit.count()).toBe(0)
  })
})
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS, 4 tests. If the migration has not been applied to `opensplit_test`, Prisma errors that a table does not exist — run `npm run db:reset:test` and retry.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema and integration test harness"
```

---

### Task 4: Auth0 boundary

**Files:**
- Create: `src/lib/auth0.ts`
- Create: `src/lib/auth.ts`
- Create: `src/middleware.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/integration/auth.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`.
- Produces:
  - `type UserClaims = { sub: string; name?: string; nickname?: string; email?: string }`
  - `upsertUserFromClaims(claims: UserClaims): Promise<User>`
  - `getCurrentUser(): Promise<User | null>`
  - `requireUser(): Promise<User>` — redirects to `/auth/login` when there is no session
  - Login route `/auth/login`, logout route `/auth/logout` (mounted by the SDK middleware)

`upsertUserFromClaims` is exported separately from `getCurrentUser` precisely so the database half can be tested without a browser session. That separation is the point of this task.

- [ ] **Step 1: Install the SDK**

```bash
npm install @auth0/nextjs-auth0
```

- [ ] **Step 2: Create an Auth0 application and fill in `.env`**

In the Auth0 dashboard create a **Regular Web Application**, and under Authentication → Database enable the **Username-Password-Authentication** connection. Set:

- Allowed Callback URLs: `http://localhost:3000/auth/callback`
- Allowed Logout URLs: `http://localhost:3000`

Fill `.env` with `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `APP_BASE_URL=http://localhost:3000`, and generate the session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] **Step 3: Create the SDK client and middleware**

Create `src/lib/auth0.ts` — the only file in the app that constructs the SDK client:

```ts
import { Auth0Client } from '@auth0/nextjs-auth0/server'

export const auth0 = new Auth0Client()
```

Create `src/middleware.ts`:

```ts
import type { NextRequest } from 'next/server'
import { auth0 } from '@/lib/auth0'

export async function middleware(request: NextRequest) {
  return auth0.middleware(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

This mounts `/auth/login`, `/auth/logout`, `/auth/callback`, and `/auth/profile`.

- [ ] **Step 4: Write the failing tests**

Create `tests/integration/auth.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { upsertUserFromClaims } from '@/lib/auth'
import { resetDb } from '../helpers/db'

beforeEach(resetDb)

describe('upsertUserFromClaims', () => {
  it('creates a user on first sight of an external id', async () => {
    const user = await upsertUserFromClaims({
      sub: 'auth0|123',
      name: 'Alice Example',
    })
    expect(user.externalId).toBe('auth0|123')
    expect(user.displayName).toBe('Alice Example')
    expect(await prisma.user.count()).toBe(1)
  })

  it('is idempotent for a repeat login', async () => {
    const first = await upsertUserFromClaims({ sub: 'auth0|123', name: 'Alice' })
    const second = await upsertUserFromClaims({ sub: 'auth0|123', name: 'Alice' })
    expect(second.id).toBe(first.id)
    expect(await prisma.user.count()).toBe(1)
  })

  it('falls back through nickname to the email local part', async () => {
    const nick = await upsertUserFromClaims({
      sub: 'auth0|nick',
      nickname: 'nickname-only',
    })
    expect(nick.displayName).toBe('nickname-only')

    const emailOnly = await upsertUserFromClaims({
      sub: 'auth0|mail',
      email: 'carol@example.com',
    })
    expect(emailOnly.displayName).toBe('carol')
  })

  it('uses a placeholder when no name claim is present at all', async () => {
    const user = await upsertUserFromClaims({ sub: 'auth0|bare' })
    expect(user.displayName).toBe('Member')
  })

  it('treats a different external id as a different user', async () => {
    await upsertUserFromClaims({ sub: 'auth0|a', name: 'A' })
    await upsertUserFromClaims({ sub: 'sms|a', name: 'A' })
    expect(await prisma.user.count()).toBe(2)
  })
})
```

That last test is the one documenting the SMS cutover: a new connection means a new `externalId`, hence a new `User`, and the old member slots get re-claimed.

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `@/lib/auth`.

- [ ] **Step 6: Write the implementation**

Create `src/lib/auth.ts`:

```ts
import { redirect } from 'next/navigation'
import type { User } from '@prisma/client'
import { auth0 } from '@/lib/auth0'
import { prisma } from '@/lib/db'

export type UserClaims = {
  sub: string
  name?: string
  nickname?: string
  email?: string
}

function displayNameFrom(claims: UserClaims): string {
  return (
    claims.name ?? claims.nickname ?? claims.email?.split('@')[0] ?? 'Member'
  )
}

export async function upsertUserFromClaims(claims: UserClaims): Promise<User> {
  return prisma.user.upsert({
    where: { externalId: claims.sub },
    create: { externalId: claims.sub, displayName: displayNameFrom(claims) },
    update: {},
  })
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await auth0.getSession()
  if (!session?.user?.sub) return null
  return upsertUserFromClaims(session.user as UserClaims)
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) redirect('/auth/login')
  return user
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS, 9 tests total.

- [ ] **Step 8: Build the layout and landing page**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'OpenSplit' }

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div className="mx-auto max-w-2xl px-4 py-8">{children}</div>
      </body>
    </html>
  )
}
```

Replace `src/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { getCurrentUser } from '@/lib/auth'

export default async function LandingPage() {
  const user = await getCurrentUser()
  if (user) redirect('/groups')

  return (
    <main className="flex flex-col items-start gap-4">
      <h1 className="text-3xl font-semibold">OpenSplit</h1>
      <p className="text-muted-foreground">
        Split shared expenses with the people you actually share them with.
      </p>
      <Button asChild>
        <a href="/auth/login">Log in</a>
      </Button>
    </main>
  )
}
```

- [ ] **Step 9: 🛑 OPERATOR GATE (V1) — verify the login round trip by hand**

Run `npm run dev`, open `http://localhost:3000`, click Log in, sign up with an email and password, and confirm you land back on the site. Then check the row exists:

```bash
npx prisma studio
```

Expected: exactly one `User` row whose `externalId` starts with `auth0|`.

Stop here and wait for the operator to confirm V1 before starting Task 5.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add Auth0 boundary, root layout, and landing page"
```

---

### Task 5: Membership check and action result wrapper

**Files:**
- Create: `src/lib/membership.ts`
- Create: `src/lib/action-result.ts`
- Create: `tests/helpers/actions.ts`
- Test: `tests/integration/membership.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/auth`, `prisma` from `@/lib/db`.
- Produces:
  - `class NotMemberError extends Error`
  - `requireMembership(groupId: string): Promise<{ user: User; member: GroupMember; group: Group }>`
  - `requireGroupMemberIds(groupId: string, memberIds: string[]): Promise<void>` — throws `NotMemberError` if any id is not in the group
  - `pageMembership(groupId: string)` — same as `requireMembership` but converts `NotMemberError` into `notFound()`
  - `type ActionResult = { ok: true } | { ok: false; error: string }`
  - `runAction(fn: () => Promise<void>): Promise<ActionResult>`
  - `mockCurrentUser(user: User | null): void` from `tests/helpers/actions`

- [ ] **Step 1: Write the failing tests**

Create `tests/helpers/actions.ts` first — every later task's tests use it:

```ts
import { vi } from 'vitest'
import type { User } from '@prisma/client'

/**
 * Server Actions and pages read the session through @/lib/auth. Tests swap
 * that module out so no browser session is needed. Every test file that
 * exercises an action needs this line at the top level:
 *
 *   vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)
 *
 * The factory must import dynamically: vi.mock is hoisted above the file's
 * own imports, so referencing an imported `authMock` binding directly throws
 * a "cannot access before initialization" error.
 */
let current: User | null = null

export function mockCurrentUser(user: User | null): void {
  current = user
}

export function currentMockUser(): User | null {
  return current
}

export const authMock = {
  getCurrentUser: async () => current,
  requireUser: async () => {
    if (!current) throw new Error('redirect(/auth/login)')
    return current
  },
  upsertUserFromClaims: async () => {
    throw new Error('not mocked')
  },
}
```

Create `tests/integration/membership.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { NotMemberError, requireGroupMemberIds, requireMembership } from '@/lib/membership'
import { mockCurrentUser } from '../helpers/actions'
import { resetDb } from '../helpers/db'

vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)

beforeEach(async () => {
  await resetDb()
  mockCurrentUser(null)
})

async function seed() {
  const alice = await prisma.user.create({
    data: { externalId: 'auth0|alice', displayName: 'Alice' },
  })
  const mallory = await prisma.user.create({
    data: { externalId: 'auth0|mallory', displayName: 'Mallory' },
  })
  const group = await prisma.group.create({
    data: {
      name: 'Trip',
      currency: 'USD',
      members: {
        create: [
          { displayName: 'Alice', userId: alice.id },
          { displayName: 'Bob', claimToken: 'tok-bob' },
        ],
      },
    },
    include: { members: true },
  })
  const other = await prisma.group.create({
    data: {
      name: 'Other',
      currency: 'USD',
      members: { create: [{ displayName: 'Outsider', claimToken: 'tok-out' }] },
    },
    include: { members: true },
  })
  return { alice, mallory, group, other }
}

describe('requireMembership', () => {
  it('returns the user, their member row, and the group', async () => {
    const { alice, group } = await seed()
    mockCurrentUser(alice)

    const result = await requireMembership(group.id)
    expect(result.user.id).toBe(alice.id)
    expect(result.member.displayName).toBe('Alice')
    expect(result.group.name).toBe('Trip')
  })

  it('throws NotMemberError for a signed-in non-member', async () => {
    const { mallory, group } = await seed()
    mockCurrentUser(mallory)

    await expect(requireMembership(group.id)).rejects.toThrow(NotMemberError)
  })

  it('throws NotMemberError for a group that does not exist', async () => {
    const { alice } = await seed()
    mockCurrentUser(alice)

    await expect(
      requireMembership('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotMemberError)
  })

  it('does not treat an unclaimed member slot as membership', async () => {
    const { group } = await seed()
    const nobody = await prisma.user.create({
      data: { externalId: 'auth0|nobody', displayName: 'Nobody' },
    })
    mockCurrentUser(nobody)

    await expect(requireMembership(group.id)).rejects.toThrow(NotMemberError)
  })
})

describe('requireGroupMemberIds', () => {
  it('accepts ids that belong to the group', async () => {
    const { group } = await seed()
    const ids = group.members.map((m) => m.id)
    await expect(requireGroupMemberIds(group.id, ids)).resolves.toBeUndefined()
  })

  it('rejects an id from another group', async () => {
    const { group, other } = await seed()
    await expect(
      requireGroupMemberIds(group.id, [other.members[0].id]),
    ).rejects.toThrow(NotMemberError)
  })

  it('rejects a mix of valid and foreign ids', async () => {
    const { group, other } = await seed()
    await expect(
      requireGroupMemberIds(group.id, [group.members[0].id, other.members[0].id]),
    ).rejects.toThrow(NotMemberError)
  })

  it('rejects an unknown id', async () => {
    const { group } = await seed()
    await expect(
      requireGroupMemberIds(group.id, ['00000000-0000-0000-0000-000000000000']),
    ).rejects.toThrow(NotMemberError)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `@/lib/membership`.

- [ ] **Step 3: Write the membership module**

Create `src/lib/membership.ts`:

```ts
import { notFound } from 'next/navigation'
import type { Group, GroupMember, User } from '@prisma/client'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * Raised when the current user is not a claimed member of the group, or the
 * group does not exist. Callers must not distinguish the two cases: pages turn
 * this into notFound(), actions into { ok: false, error: 'Not found' }.
 */
export class NotMemberError extends Error {
  constructor() {
    super('Not found')
    this.name = 'NotMemberError'
  }
}

export async function requireMembership(groupId: string): Promise<{
  user: User
  member: GroupMember
  group: Group
}> {
  const user = await requireUser()
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId: user.id },
    include: { group: true },
  })
  if (!member) throw new NotMemberError()

  const { group, ...memberRow } = member
  return { user, member: memberRow, group }
}

/** Verifies every supplied member id belongs to this group. */
export async function requireGroupMemberIds(
  groupId: string,
  memberIds: string[],
): Promise<void> {
  const unique = [...new Set(memberIds)]
  if (unique.length === 0) return

  const found = await prisma.groupMember.count({
    where: { groupId, id: { in: unique } },
  })
  if (found !== unique.length) throw new NotMemberError()
}

/** requireMembership for use in a page: renders the 404 page instead of throwing. */
export async function pageMembership(groupId: string) {
  try {
    return await requireMembership(groupId)
  } catch (error) {
    if (error instanceof NotMemberError) notFound()
    throw error
  }
}
```

- [ ] **Step 4: Write the action result wrapper**

Create `src/lib/action-result.ts`:

```ts
import { NotMemberError } from '@/lib/membership'

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Runs an action body and converts known failures into a value the form can
 * render. NotMemberError becomes 'Not found' so non-members learn nothing
 * about whether the group exists.
 */
export async function runAction(
  fn: () => Promise<void>,
): Promise<ActionResult> {
  try {
    await fn()
    return { ok: true }
  } catch (error) {
    if (error instanceof NotMemberError) return { ok: false, error: 'Not found' }
    if (error instanceof ValidationError) return { ok: false, error: error.message }
    throw error
  }
}

/** Thrown by actions for input the user can fix. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS, 17 tests total.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add membership authorization and action result wrapper"
```

---

### Task 6: Group creation and the group list page

**Files:**
- Create: `src/lib/actions/groups.ts`
- Create: `src/components/new-group-dialog.tsx`
- Create: `src/app/groups/page.tsx`
- Test: `tests/integration/groups.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `requireMembership`, `prisma`, `runAction`, `ValidationError`, `CURRENCIES`, `formatMoney`, `computeBalances`.
- Produces:
  - `createGroup(input: { name: string; currency: string }): Promise<ActionResult & { groupId?: string }>`
  - `renameGroup(input: { groupId: string; name: string }): Promise<ActionResult>`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/groups.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { createGroup, renameGroup } from '@/lib/actions/groups'
import { mockCurrentUser } from '../helpers/actions'
import { resetDb } from '../helpers/db'

vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(async () => {
  await resetDb()
  mockCurrentUser(null)
})

const makeUser = (tag: string) =>
  prisma.user.create({
    data: { externalId: `auth0|${tag}`, displayName: tag },
  })

describe('createGroup', () => {
  it('creates the group and the creator membership together', async () => {
    const alice = await makeUser('alice')
    mockCurrentUser(alice)

    const result = await createGroup({ name: 'Trip to Lisbon', currency: 'USD' })
    expect(result.ok).toBe(true)

    const group = await prisma.group.findFirstOrThrow({ include: { members: true } })
    expect(group.name).toBe('Trip to Lisbon')
    expect(group.members).toHaveLength(1)
    expect(group.members[0].userId).toBe(alice.id)
    expect(group.members[0].displayName).toBe('alice')
    expect(group.members[0].claimToken).toBeNull()
  })

  it('rejects a blank name', async () => {
    mockCurrentUser(await makeUser('alice'))
    const result = await createGroup({ name: '   ', currency: 'USD' })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.group.count()).toBe(0)
  })

  it('rejects an unsupported currency', async () => {
    mockCurrentUser(await makeUser('alice'))
    const result = await createGroup({ name: 'Trip', currency: 'JPY' })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.group.count()).toBe(0)
  })
})

describe('renameGroup', () => {
  it('lets any member rename the group', async () => {
    const alice = await makeUser('alice')
    mockCurrentUser(alice)
    await createGroup({ name: 'Old', currency: 'USD' })
    const group = await prisma.group.findFirstOrThrow()

    const result = await renameGroup({ groupId: group.id, name: 'New' })
    expect(result.ok).toBe(true)
    expect((await prisma.group.findFirstOrThrow()).name).toBe('New')
  })

  it('refuses a non-member with a generic not-found error', async () => {
    mockCurrentUser(await makeUser('alice'))
    await createGroup({ name: 'Old', currency: 'USD' })
    const group = await prisma.group.findFirstOrThrow()

    mockCurrentUser(await makeUser('mallory'))
    const result = await renameGroup({ groupId: group.id, name: 'Hacked' })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect((await prisma.group.findFirstOrThrow()).name).toBe('Old')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `@/lib/actions/groups`.

- [ ] **Step 3: Write the actions**

Create `src/lib/actions/groups.ts`:

```ts
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
```

Note the ordering: validate the shape first, then check membership. Both orders are safe here because the Zod schema reveals nothing, but membership must be checked before any write.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS, 22 tests total.

- [ ] **Step 5: Build the new-group dialog**

Create `src/components/new-group-dialog.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createGroup } from '@/lib/actions/groups'
import { CURRENCIES } from '@/lib/money'

export function NewGroupDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<string>('USD')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await createGroup({ name, currency })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      setName('')
      if (result.groupId) router.push(`/groups/${result.groupId}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New group</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Trip to Lisbon"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-currency">Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="group-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 6: Build the group list page**

Create `src/app/groups/page.tsx`:

```tsx
import Link from 'next/link'
import { NewGroupDialog } from '@/components/new-group-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { requireUser } from '@/lib/auth'
import { computeBalances } from '@/lib/balances'
import { prisma } from '@/lib/db'
import { formatMoney } from '@/lib/money'

export default async function GroupsPage() {
  const user = await requireUser()

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: user.id } } },
    orderBy: { createdAt: 'desc' },
    include: {
      members: { select: { id: true, userId: true } },
      transactions: {
        select: {
          payerMemberId: true,
          amountMinor: true,
          splits: { select: { memberId: true, shareMinor: true } },
        },
      },
    },
  })

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your groups</h1>
        <NewGroupDialog />
      </div>

      {groups.length === 0 && (
        <p className="text-muted-foreground">
          No groups yet. Create one to get started.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {groups.map((group) => {
          const memberIds = group.members.map((m) => m.id)
          const balances = computeBalances(memberIds, group.transactions)
          const mine = group.members.find((m) => m.userId === user.id)
          const net = mine ? (balances.get(mine.id) ?? 0) : 0

          return (
            <li key={group.id}>
              <Link href={`/groups/${group.id}`}>
                <Card className="transition-colors hover:bg-accent">
                  <CardContent className="flex items-center justify-between p-4">
                    <span className="font-medium">{group.name}</span>
                    <span
                      className={
                        net > 0
                          ? 'text-emerald-600'
                          : net < 0
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      }
                    >
                      {net === 0
                        ? 'settled up'
                        : net > 0
                          ? `you are owed ${formatMoney(net, group.currency)}`
                          : `you owe ${formatMoney(-net, group.currency)}`}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
```

- [ ] **Step 7: Verify by hand**

Run `npm run dev`, log in, create a group, and confirm it appears in the list showing "settled up" and that you are redirected to its page (which 404s until Task 10 — that is expected).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add group creation and group list page"
```

---

### Task 7: Placeholder members

**Files:**
- Create: `src/lib/actions/members.ts`
- Create: `src/components/members-section.tsx`
- Test: `tests/integration/members.test.ts`

**Interfaces:**
- Consumes: `requireMembership`, `prisma`, `runAction`, `ValidationError`.
- Produces:
  - `addPlaceholderMember(input: { groupId: string; displayName: string }): Promise<ActionResult>`
  - `removeMember(input: { groupId: string; memberId: string }): Promise<ActionResult>`
  - `<MembersSection groupId members baseUrl />` where `members` is
    `{ id: string; displayName: string; isYou: boolean; claimToken: string | null }[]`

`claimMember` lands in the same file in Task 8.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/members.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { addPlaceholderMember, removeMember } from '@/lib/actions/members'
import { mockCurrentUser } from '../helpers/actions'
import { resetDb } from '../helpers/db'

vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(async () => {
  await resetDb()
  mockCurrentUser(null)
})

async function seedGroup() {
  const alice = await prisma.user.create({
    data: { externalId: 'auth0|alice', displayName: 'Alice' },
  })
  const group = await prisma.group.create({
    data: {
      name: 'Trip',
      currency: 'USD',
      members: { create: [{ displayName: 'Alice', userId: alice.id }] },
    },
    include: { members: true },
  })
  return { alice, group, aliceMember: group.members[0] }
}

describe('addPlaceholderMember', () => {
  it('creates an unclaimed member with a claim token', async () => {
    const { alice, group } = await seedGroup()
    mockCurrentUser(alice)

    const result = await addPlaceholderMember({
      groupId: group.id,
      displayName: 'Bob',
    })
    expect(result.ok).toBe(true)

    const bob = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Bob' },
    })
    expect(bob.userId).toBeNull()
    expect(bob.claimToken).toMatch(/^[A-Za-z0-9_-]{20,}$/)
  })

  it('gives each placeholder a distinct token', async () => {
    const { alice, group } = await seedGroup()
    mockCurrentUser(alice)
    await addPlaceholderMember({ groupId: group.id, displayName: 'Bob' })
    await addPlaceholderMember({ groupId: group.id, displayName: 'Carol' })

    const tokens = (
      await prisma.groupMember.findMany({ where: { claimToken: { not: null } } })
    ).map((m) => m.claimToken)
    expect(new Set(tokens).size).toBe(2)
  })

  it('rejects a blank name', async () => {
    const { alice, group } = await seedGroup()
    mockCurrentUser(alice)
    const result = await addPlaceholderMember({ groupId: group.id, displayName: ' ' })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.groupMember.count()).toBe(1)
  })

  it('refuses a non-member', async () => {
    const { group } = await seedGroup()
    const mallory = await prisma.user.create({
      data: { externalId: 'auth0|mallory', displayName: 'Mallory' },
    })
    mockCurrentUser(mallory)

    const result = await addPlaceholderMember({ groupId: group.id, displayName: 'X' })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.groupMember.count()).toBe(1)
  })
})

describe('removeMember', () => {
  it('removes a member with no transactions', async () => {
    const { alice, group } = await seedGroup()
    mockCurrentUser(alice)
    await addPlaceholderMember({ groupId: group.id, displayName: 'Bob' })
    const bob = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Bob' },
    })

    const result = await removeMember({ groupId: group.id, memberId: bob.id })
    expect(result.ok).toBe(true)
    expect(await prisma.groupMember.count()).toBe(1)
  })

  it('refuses to remove a member who paid for something', async () => {
    const { alice, group, aliceMember } = await seedGroup()
    mockCurrentUser(alice)
    await prisma.transaction.create({
      data: {
        groupId: group.id,
        kind: 'EXPENSE',
        description: 'Lunch',
        amountMinor: 1000,
        payerMemberId: aliceMember.id,
        occurredAt: new Date('2026-07-28'),
        splits: { create: [{ memberId: aliceMember.id, shareMinor: 1000 }] },
      },
    })

    const result = await removeMember({ groupId: group.id, memberId: aliceMember.id })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.groupMember.count()).toBe(1)
  })

  it('refuses to remove a member who appears in a split', async () => {
    const { alice, group, aliceMember } = await seedGroup()
    mockCurrentUser(alice)
    await addPlaceholderMember({ groupId: group.id, displayName: 'Bob' })
    const bob = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Bob' },
    })
    await prisma.transaction.create({
      data: {
        groupId: group.id,
        kind: 'EXPENSE',
        description: 'Lunch',
        amountMinor: 1000,
        payerMemberId: aliceMember.id,
        occurredAt: new Date('2026-07-28'),
        splits: {
          create: [
            { memberId: aliceMember.id, shareMinor: 500 },
            { memberId: bob.id, shareMinor: 500 },
          ],
        },
      },
    })

    const result = await removeMember({ groupId: group.id, memberId: bob.id })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.groupMember.count()).toBe(2)
  })

  it('refuses a member id from another group', async () => {
    const { alice, group } = await seedGroup()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })
    mockCurrentUser(alice)

    const result = await removeMember({
      groupId: group.id,
      memberId: other.members[0].id,
    })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.groupMember.count()).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `@/lib/actions/members`.

- [ ] **Step 3: Write the actions**

Create `src/lib/actions/members.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS, 30 tests total.

- [ ] **Step 5: Build the members section**

Create `src/components/members-section.tsx`:

```tsx
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
          <li key={member.id} className="flex items-center gap-2 text-sm">
            <span>
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
                  onClick={() => copyClaimLink(member.claimToken!)}
                >
                  {copied === member.claimToken ? 'Copied' : 'Copy invite link'}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive"
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
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add placeholder members with claim tokens"
```

---

### Task 8: Claiming a member slot

**Files:**
- Modify: `src/lib/actions/members.ts` (add `claimMember`)
- Create: `src/app/claim/[token]/page.tsx`
- Test: `tests/integration/claim.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `prisma`, `runAction`, `ValidationError`.
- Produces: `claimMember(input: { token: string }): Promise<ActionResult & { groupId?: string }>`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/claim.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { claimMember } from '@/lib/actions/members'
import { mockCurrentUser } from '../helpers/actions'
import { resetDb } from '../helpers/db'

vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(async () => {
  await resetDb()
  mockCurrentUser(null)
})

async function seed() {
  const alice = await prisma.user.create({
    data: { externalId: 'auth0|alice', displayName: 'Alice' },
  })
  const bob = await prisma.user.create({
    data: { externalId: 'auth0|bob', displayName: 'Bob' },
  })
  const group = await prisma.group.create({
    data: {
      name: 'Trip',
      currency: 'USD',
      members: {
        create: [
          { displayName: 'Alice', userId: alice.id },
          { displayName: 'Bob', claimToken: 'tok-bob' },
          { displayName: 'Carol', claimToken: 'tok-carol' },
        ],
      },
    },
    include: { members: true },
  })
  return { alice, bob, group }
}

describe('claimMember', () => {
  it('links the member to the user and clears the token', async () => {
    const { bob, group } = await seed()
    mockCurrentUser(bob)

    const result = await claimMember({ token: 'tok-bob' })
    expect(result).toMatchObject({ ok: true, groupId: group.id })

    const member = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Bob' },
    })
    expect(member.userId).toBe(bob.id)
    expect(member.claimToken).toBeNull()
  })

  it('refuses a token that has already been used', async () => {
    const { bob } = await seed()
    mockCurrentUser(bob)
    await claimMember({ token: 'tok-bob' })

    const other = await prisma.user.create({
      data: { externalId: 'auth0|other', displayName: 'Other' },
    })
    mockCurrentUser(other)

    const result = await claimMember({ token: 'tok-bob' })
    expect(result).toMatchObject({ ok: false })
    const member = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Bob' },
    })
    expect(member.userId).toBe(bob.id)
  })

  it('refuses an unknown token', async () => {
    const { bob } = await seed()
    mockCurrentUser(bob)
    expect(await claimMember({ token: 'nope' })).toMatchObject({ ok: false })
  })

  it('refuses a user who already holds a slot in that group', async () => {
    const { alice } = await seed()
    mockCurrentUser(alice)

    const result = await claimMember({ token: 'tok-carol' })
    expect(result).toMatchObject({ ok: false })

    const carol = await prisma.groupMember.findFirstOrThrow({
      where: { displayName: 'Carol' },
    })
    expect(carol.userId).toBeNull()
    expect(carol.claimToken).toBe('tok-carol')
  })

  it('lets the same user claim slots in two different groups', async () => {
    const { bob } = await seed()
    const second = await prisma.group.create({
      data: {
        name: 'Second',
        currency: 'USD',
        members: { create: [{ displayName: 'Bob', claimToken: 'tok-bob-2' }] },
      },
    })
    mockCurrentUser(bob)

    expect(await claimMember({ token: 'tok-bob' })).toMatchObject({ ok: true })
    expect(await claimMember({ token: 'tok-bob-2' })).toMatchObject({
      ok: true,
      groupId: second.id,
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — `claimMember` is not exported from `@/lib/actions/members`.

- [ ] **Step 3: Add the action**

Append to `src/lib/actions/members.ts`:

```ts
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
```

Add `requireUser` to the imports at the top of the file:

```ts
import { requireUser } from '@/lib/auth'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS, 35 tests total.

- [ ] **Step 5: Build the claim page**

Create `src/app/claim/[token]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { ClaimButton } from './claim-button'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  await requireUser()

  const member = await prisma.groupMember.findUnique({
    where: { claimToken: token },
    include: { group: true },
  })
  if (!member) notFound()

  return (
    <main className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold">
        You&apos;ve been invited as {member.displayName}
      </h1>
      <p className="text-muted-foreground">in {member.group.name}</p>
      <ClaimButton token={token} />
    </main>
  )
}
```

Create `src/app/claim/[token]/claim-button.tsx`:

```tsx
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
```

- [ ] **Step 6: 🛑 OPERATOR GATE (V2) — verify the full invite loop by hand**

With `npm run dev` running: create a group, add a placeholder member, copy the invite link, open it in a private window, sign up as a second user, and confirm you join the group and appear as claimed. Then reopen the same link in a third window and confirm it reports the link is invalid or used.

Stop here and wait for the operator to confirm V2 before starting Task 9.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add member claim flow"
```

---

### Task 9: Transactions and settlements

**Files:**
- Create: `src/lib/actions/transactions.ts`
- Test: `tests/integration/transactions.test.ts`

**Interfaces:**
- Consumes: `requireMembership`, `requireGroupMemberIds`, `prisma`, `runAction`, `ValidationError`, `splitEvenly`, `MAX_AMOUNT_MINOR`.
- Produces:
  - `addTransaction(input: { groupId: string; description: string; amountMinor: number; payerMemberId: string; includedMemberIds: string[]; occurredAt: string }): Promise<ActionResult>`
  - `updateTransaction(input: { transactionId: string; groupId: string; description: string; amountMinor: number; payerMemberId: string; includedMemberIds: string[]; occurredAt: string }): Promise<ActionResult>`
  - `deleteTransaction(input: { groupId: string; transactionId: string }): Promise<ActionResult>`
  - `recordSettlement(input: { groupId: string; fromMemberId: string; toMemberId: string; amountMinor: number; occurredAt: string }): Promise<ActionResult>`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/transactions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import {
  addTransaction,
  deleteTransaction,
  recordSettlement,
  updateTransaction,
} from '@/lib/actions/transactions'
import { MAX_AMOUNT_MINOR } from '@/lib/money'
import { mockCurrentUser } from '../helpers/actions'
import { resetDb } from '../helpers/db'

vi.mock('@/lib/auth', async () => (await import('../helpers/actions')).authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(async () => {
  await resetDb()
  mockCurrentUser(null)
})

async function seed() {
  const alice = await prisma.user.create({
    data: { externalId: 'auth0|alice', displayName: 'Alice' },
  })
  const group = await prisma.group.create({
    data: {
      name: 'Trip',
      currency: 'USD',
      members: {
        create: [
          { displayName: 'Alice', userId: alice.id },
          { displayName: 'Bob', claimToken: 'tok-bob' },
          { displayName: 'Carol', claimToken: 'tok-carol' },
        ],
      },
    },
    include: { members: { orderBy: { displayName: 'asc' } } },
  })
  const [a, b, c] = group.members
  mockCurrentUser(alice)
  return { alice, group, a, b, c }
}

const baseInput = (overrides: Record<string, unknown>) => ({
  description: 'Dinner',
  amountMinor: 7650,
  occurredAt: '2026-07-28',
  ...overrides,
})

describe('addTransaction', () => {
  it('stores split rows that sum to the amount', async () => {
    const { group, a, b, c } = await seed()

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, b.id, c.id],
      }) as never,
    )
    expect(result.ok).toBe(true)

    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.kind).toBe('EXPENSE')
    expect(tx.amountMinor).toBe(7650)
    expect(tx.splits).toHaveLength(3)
    expect(tx.splits.reduce((sum, s) => sum + s.shareMinor, 0)).toBe(7650)
  })

  it('allows a payer who is not included in the split', async () => {
    const { group, a, b, c } = await seed()

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [b.id, c.id],
      }) as never,
    )
    expect(result.ok).toBe(true)

    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.splits.map((s) => s.memberId).sort()).toEqual([b.id, c.id].sort())
  })

  it('rejects an empty included-members list', async () => {
    const { group, a } = await seed()
    const result = await addTransaction(
      baseInput({ groupId: group.id, payerMemberId: a.id, includedMemberIds: [] }) as never,
    )
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a non-positive amount', async () => {
    const { group, a } = await seed()
    for (const amountMinor of [0, -100]) {
      const result = await addTransaction(
        baseInput({
          groupId: group.id,
          payerMemberId: a.id,
          includedMemberIds: [a.id],
          amountMinor,
        }) as never,
      )
      expect(result).toMatchObject({ ok: false })
    }
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects an amount above MAX_AMOUNT_MINOR', async () => {
    const { group, a } = await seed()
    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id],
        amountMinor: MAX_AMOUNT_MINOR + 1,
      }) as never,
    )
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a payer from another group', async () => {
    const { group, a } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: other.members[0].id,
        includedMemberIds: [a.id],
      }) as never,
    )
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a split target from another group', async () => {
    const { group, a } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, other.members[0].id],
      }) as never,
    )
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('refuses a non-member of the group entirely', async () => {
    const { group, a } = await seed()
    const mallory = await prisma.user.create({
      data: { externalId: 'auth0|mallory', displayName: 'Mallory' },
    })
    mockCurrentUser(mallory)

    const result = await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id],
      }) as never,
    )
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(0)
  })
})

describe('updateTransaction', () => {
  it('replaces the split rows rather than patching them', async () => {
    const { group, a, b, c } = await seed()
    await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, b.id, c.id],
      }) as never,
    )
    const before = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })

    const result = await updateTransaction({
      transactionId: before.id,
      groupId: group.id,
      description: 'Dinner (fixed)',
      amountMinor: 3000,
      payerMemberId: b.id,
      includedMemberIds: [a.id, b.id],
      occurredAt: '2026-07-29',
    })
    expect(result.ok).toBe(true)

    const after = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(after.description).toBe('Dinner (fixed)')
    expect(after.payerMemberId).toBe(b.id)
    expect(after.splits).toHaveLength(2)
    expect(after.splits.reduce((sum, s) => sum + s.shareMinor, 0)).toBe(3000)
    expect(await prisma.transactionSplit.count()).toBe(2)
  })

  it('refuses a transaction id from another group', async () => {
    const { group, a } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })
    const foreign = await prisma.transaction.create({
      data: {
        groupId: other.id,
        kind: 'EXPENSE',
        description: 'Theirs',
        amountMinor: 500,
        payerMemberId: other.members[0].id,
        occurredAt: new Date('2026-07-28'),
        splits: { create: [{ memberId: other.members[0].id, shareMinor: 500 }] },
      },
    })

    const result = await updateTransaction({
      transactionId: foreign.id,
      groupId: group.id,
      description: 'Hijacked',
      amountMinor: 100,
      payerMemberId: a.id,
      includedMemberIds: [a.id],
      occurredAt: '2026-07-29',
    })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect((await prisma.transaction.findFirstOrThrow({ where: { id: foreign.id } })).description).toBe('Theirs')
  })
})

describe('deleteTransaction', () => {
  it('deletes the transaction and its splits', async () => {
    const { group, a, b } = await seed()
    await addTransaction(
      baseInput({
        groupId: group.id,
        payerMemberId: a.id,
        includedMemberIds: [a.id, b.id],
      }) as never,
    )
    const tx = await prisma.transaction.findFirstOrThrow()

    const result = await deleteTransaction({ groupId: group.id, transactionId: tx.id })
    expect(result.ok).toBe(true)
    expect(await prisma.transaction.count()).toBe(0)
    expect(await prisma.transactionSplit.count()).toBe(0)
  })

  it('refuses a transaction that belongs to another group', async () => {
    const { group } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })
    const foreign = await prisma.transaction.create({
      data: {
        groupId: other.id,
        kind: 'EXPENSE',
        description: 'Theirs',
        amountMinor: 500,
        payerMemberId: other.members[0].id,
        occurredAt: new Date('2026-07-28'),
        splits: { create: [{ memberId: other.members[0].id, shareMinor: 500 }] },
      },
    })

    const result = await deleteTransaction({
      groupId: group.id,
      transactionId: foreign.id,
    })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(1)
  })
})

describe('recordSettlement', () => {
  it('writes a settlement with a single split on the recipient', async () => {
    const { group, a, b } = await seed()

    const result = await recordSettlement({
      groupId: group.id,
      fromMemberId: b.id,
      toMemberId: a.id,
      amountMinor: 2550,
      occurredAt: '2026-07-29',
    })
    expect(result.ok).toBe(true)

    const tx = await prisma.transaction.findFirstOrThrow({ include: { splits: true } })
    expect(tx.kind).toBe('SETTLEMENT')
    expect(tx.payerMemberId).toBe(b.id)
    expect(tx.splits).toHaveLength(1)
    expect(tx.splits[0].memberId).toBe(a.id)
    expect(tx.splits[0].shareMinor).toBe(2550)
  })

  it('rejects a settlement to oneself', async () => {
    const { group, a } = await seed()
    const result = await recordSettlement({
      groupId: group.id,
      fromMemberId: a.id,
      toMemberId: a.id,
      amountMinor: 100,
      occurredAt: '2026-07-29',
    })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.transaction.count()).toBe(0)
  })

  it('rejects a member from another group', async () => {
    const { group, a } = await seed()
    const other = await prisma.group.create({
      data: {
        name: 'Other',
        currency: 'USD',
        members: { create: [{ displayName: 'Outsider', claimToken: 'tok' }] },
      },
      include: { members: true },
    })

    const result = await recordSettlement({
      groupId: group.id,
      fromMemberId: other.members[0].id,
      toMemberId: a.id,
      amountMinor: 100,
      occurredAt: '2026-07-29',
    })
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(await prisma.transaction.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `@/lib/actions/transactions`.

- [ ] **Step 3: Write the actions**

Create `src/lib/actions/transactions.ts`:

```ts
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
```

Both `updateTransaction` and `deleteTransaction` throw `NotMemberError` — not `ValidationError` — when the transaction id does not belong to this group. That is deliberate: a caller probing another group's transaction ids must get the same generic "Not found" as a non-member.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS, 50 tests total.

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:all`
Expected: PASS — 18 unit tests, 50 integration tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add transaction and settlement actions"
```

---

### Task 10: The group page

Assembles everything into the single scrolling column from the spec: header, summary, settle up, members, transactions.

**Files:**
- Create: `src/components/balance-summary.tsx`
- Create: `src/components/add-transaction-dialog.tsx`
- Create: `src/components/settlement-dialog.tsx`
- Create: `src/components/transaction-list.tsx`
- Create: `src/app/groups/[id]/page.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 1–9. Notably `pageMembership`, `computeBalances`, `suggestTransfers`, `formatMoney`, `MembersSection`, all four transaction actions.
- Produces: the `/groups/[id]` route. No new exported logic.

- [ ] **Step 1: Add the amount parser to `lib/money.ts` with its test**

It lives in `lib/money.ts`, not in the dialog, so the unit test can import it without pulling a `'use client'` module into the node test environment.

Append to `src/lib/money.ts`:

```ts
/**
 * Parses user-typed currency text like "42.50" into 4250 minor units.
 * Returns null for anything that is not a positive amount with at most two
 * decimal places.
 */
export function parseAmountToMinor(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null

  const [whole, fraction = ''] = trimmed.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}
```

Append to `tests/unit/money.test.ts`, extending the existing import from `@/lib/money` to include `parseAmountToMinor`:

```ts
describe('parseAmountToMinor', () => {
  it('parses whole and fractional amounts', () => {
    expect(parseAmountToMinor('42.50')).toBe(4250)
    expect(parseAmountToMinor('42')).toBe(4200)
    expect(parseAmountToMinor('0.07')).toBe(7)
    expect(parseAmountToMinor(' 12.3 ')).toBe(1230)
  })

  it('rejects junk, negatives, zero, and extra precision', () => {
    for (const text of ['', 'abc', '-5', '0', '0.00', '1.234', '1,5', '1.']) {
      expect(parseAmountToMinor(text)).toBeNull()
    }
  })
})
```

Run: `npm test`
Expected: PASS, 10 tests in `money.test.ts`, 20 unit tests overall.

- [ ] **Step 2: Build the add-transaction dialog**

Create `src/components/add-transaction-dialog.tsx`:

```tsx
'use client'

import { useMemo, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { addTransaction } from '@/lib/actions/transactions'
import { formatMoney, parseAmountToMinor, splitEvenly } from '@/lib/money'

export type MemberOption = { id: string; displayName: string }

export function AddTransactionDialog({
  groupId,
  currency,
  members,
  defaultPayerId,
}: {
  groupId: string
  currency: string
  members: MemberOption[]
  defaultPayerId: string
}) {
  const [open, setOpen] = useState(false)
  const [amountText, setAmountText] = useState('')
  const [description, setDescription] = useState('')
  const [occurredAt, setOccurredAt] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [payerMemberId, setPayerMemberId] = useState(defaultPayerId)
  const [included, setIncluded] = useState<string[]>(members.map((m) => m.id))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const amountMinor = parseAmountToMinor(amountText)

  const preview = useMemo(() => {
    if (!amountMinor || included.length === 0) return null
    const shares = splitEvenly(amountMinor, included)
    const values = [...shares.values()]
    const min = Math.min(...values)
    const max = Math.max(...values)
    return min === max
      ? `${formatMoney(min, currency)} each`
      : `${formatMoney(min, currency)}–${formatMoney(max, currency)} each`
  }, [amountMinor, included, currency])

  function toggle(memberId: string) {
    setIncluded((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId],
    )
  }

  function submit() {
    setError(null)
    if (!amountMinor) return setError('Enter an amount like 42.50')

    startTransition(async () => {
      const result = await addTransaction({
        groupId,
        description,
        amountMinor,
        payerMemberId,
        includedMemberIds: included,
        occurredAt,
      })
      if (!result.ok) return setError(result.error)
      setOpen(false)
      setAmountText('')
      setDescription('')
      setIncluded(members.map((m) => m.id))
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an expense</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="amount">Amount ({currency})</Label>
            <Input
              id="amount"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="42.50"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Dinner at Ramiro"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="payer">Paid by</Label>
            <Select value={payerMemberId} onValueChange={setPayerMemberId}>
              <SelectTrigger id="payer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Split between</Label>
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={included.includes(m.id)}
                  onCheckedChange={() => toggle(m.id)}
                />
                {m.displayName}
              </label>
            ))}
            {preview && (
              <p className="text-sm text-muted-foreground">{preview}</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Build the settlement dialog**

Create `src/components/settlement-dialog.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import type { MemberOption } from '@/components/add-transaction-dialog'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { recordSettlement } from '@/lib/actions/transactions'
import { parseAmountToMinor } from '@/lib/money'

export function SettlementDialog({
  groupId,
  currency,
  members,
  prefill,
  onClose,
}: {
  groupId: string
  currency: string
  members: MemberOption[]
  prefill: { fromMemberId: string; toMemberId: string; amountMinor: number } | null
  onClose: () => void
}) {
  const [fromMemberId, setFrom] = useState(prefill?.fromMemberId ?? members[0].id)
  const [toMemberId, setTo] = useState(prefill?.toMemberId ?? members[1]?.id ?? members[0].id)
  const [amountText, setAmountText] = useState(
    prefill ? (prefill.amountMinor / 100).toFixed(2) : '',
  )
  const [occurredAt, setOccurredAt] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    const amountMinor = parseAmountToMinor(amountText)
    if (!amountMinor) return setError('Enter an amount like 25.00')

    startTransition(async () => {
      const result = await recordSettlement({
        groupId,
        fromMemberId,
        toMemberId,
        amountMinor,
        occurredAt,
      })
      if (!result.ok) return setError(result.error)
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="from">From</Label>
            <Select value={fromMemberId} onValueChange={setFrom}>
              <SelectTrigger id="from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="to">To</Label>
            <Select value={toMemberId} onValueChange={setTo}>
              <SelectTrigger id="to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="settle-amount">Amount ({currency})</Label>
            <Input
              id="settle-amount"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="settle-date">Date</Label>
            <Input
              id="settle-date"
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Build the balance summary with settle-up suggestions**

Create `src/components/balance-summary.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { MemberOption } from '@/components/add-transaction-dialog'
import { SettlementDialog } from '@/components/settlement-dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { Transfer } from '@/lib/balances'
import { formatMoney } from '@/lib/money'

export function BalanceSummary({
  groupId,
  currency,
  members,
  balances,
  transfers,
  yourMemberId,
}: {
  groupId: string
  currency: string
  members: MemberOption[]
  balances: { memberId: string; net: number }[]
  transfers: Transfer[]
  yourMemberId: string
}) {
  const [prefill, setPrefill] = useState<Transfer | null>(null)
  const [open, setOpen] = useState(false)
  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? 'Unknown'

  const yours = balances.find((b) => b.memberId === yourMemberId)?.net ?? 0

  return (
    <section className="flex flex-col gap-3">
      <p className="text-lg">
        {yours === 0
          ? 'You are settled up.'
          : yours > 0
            ? `You are owed ${formatMoney(yours, currency)}`
            : `You owe ${formatMoney(-yours, currency)}`}
      </p>

      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {balances.map(({ memberId, net }) => (
          <li key={memberId}>
            <span className="text-muted-foreground">{nameOf(memberId)} </span>
            <span
              className={
                net > 0 ? 'text-emerald-600' : net < 0 ? 'text-destructive' : ''
              }
            >
              {net === 0
                ? '—'
                : `${net > 0 ? '+' : '−'}${formatMoney(Math.abs(net), currency)}`}
            </span>
          </li>
        ))}
      </ul>

      <Separator />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Settle up</h2>
        {transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to settle.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {transfers.map((t, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span>
                  {nameOf(t.fromMemberId)} → {nameOf(t.toMemberId)}
                </span>
                <span className="font-medium">
                  {formatMoney(t.amountMinor, currency)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => {
                    setPrefill(t)
                    setOpen(true)
                  }}
                >
                  Record
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            setPrefill(null)
            setOpen(true)
          }}
        >
          Record another payment
        </Button>
      </div>

      {open && (
        <SettlementDialog
          groupId={groupId}
          currency={currency}
          members={members}
          prefill={prefill}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  )
}
```

- [ ] **Step 5: Build the transaction list**

Create `src/components/transaction-list.tsx`:

```tsx
'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { deleteTransaction } from '@/lib/actions/transactions'
import { formatMoney } from '@/lib/money'

export type TransactionRow = {
  id: string
  kind: 'EXPENSE' | 'SETTLEMENT'
  description: string
  amountMinor: number
  payerName: string
  recipientName: string | null
  splitCount: number
  occurredAt: string
}

export function TransactionList({
  groupId,
  currency,
  transactions,
}: {
  groupId: string
  currency: string
  transactions: TransactionRow[]
}) {
  const [pending, startTransition] = useTransition()

  if (transactions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No transactions yet. Add the first one.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {transactions.map((tx) => (
        <li key={tx.id} className="flex items-start gap-3 text-sm">
          <span className="w-16 shrink-0 text-muted-foreground">
            {tx.occurredAt}
          </span>
          <div className="flex flex-col">
            <span className="font-medium">
              {tx.kind === 'SETTLEMENT'
                ? `${tx.payerName} paid ${tx.recipientName}`
                : tx.description}
            </span>
            <span className="text-muted-foreground">
              {tx.kind === 'SETTLEMENT'
                ? formatMoney(tx.amountMinor, currency)
                : `${tx.payerName} paid ${formatMoney(tx.amountMinor, currency)} · split ${tx.splitCount} ${tx.splitCount === 1 ? 'way' : 'ways'}`}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await deleteTransaction({ groupId, transactionId: tx.id })
              })
            }
          >
            Delete
          </Button>
        </li>
      ))}
    </ul>
  )
}
```

`updateTransaction` is exercised by tests and reachable from the API, but no edit UI ships in this task — deleting and re-adding covers the case. Note this as a known gap rather than leaving a half-built edit form.

- [ ] **Step 6: Assemble the group page**

Create `src/app/groups/[id]/page.tsx`:

```tsx
import { AddTransactionDialog } from '@/components/add-transaction-dialog'
import { BalanceSummary } from '@/components/balance-summary'
import { MembersSection } from '@/components/members-section'
import { TransactionList, type TransactionRow } from '@/components/transaction-list'
import { Separator } from '@/components/ui/separator'
import { computeBalances, suggestTransfers } from '@/lib/balances'
import { prisma } from '@/lib/db'
import { pageMembership } from '@/lib/membership'

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { user, member: you, group } = await pageMembership(id)

  const members = await prisma.groupMember.findMany({
    where: { groupId: group.id },
    orderBy: { createdAt: 'asc' },
  })

  const transactions = await prisma.transaction.findMany({
    where: { groupId: group.id },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    include: { splits: true },
  })

  const memberIds = members.map((m) => m.id)
  const balances = computeBalances(memberIds, transactions)
  const transfers = suggestTransfers(balances)
  const nameOf = (memberId: string) =>
    members.find((m) => m.id === memberId)?.displayName ?? 'Unknown'

  const rows: TransactionRow[] = transactions.map((tx) => ({
    id: tx.id,
    kind: tx.kind,
    description: tx.description,
    amountMinor: tx.amountMinor,
    payerName: nameOf(tx.payerMemberId),
    recipientName:
      tx.kind === 'SETTLEMENT' && tx.splits[0]
        ? nameOf(tx.splits[0].memberId)
        : null,
    splitCount: tx.splits.length,
    occurredAt: tx.occurredAt.toISOString().slice(0, 10),
  }))

  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000'

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{group.name}</h1>
          <p className="text-sm text-muted-foreground">{group.currency}</p>
        </div>
        <AddTransactionDialog
          groupId={group.id}
          currency={group.currency}
          members={members.map((m) => ({ id: m.id, displayName: m.displayName }))}
          defaultPayerId={you.id}
        />
      </div>

      <Separator />

      <BalanceSummary
        groupId={group.id}
        currency={group.currency}
        members={members.map((m) => ({ id: m.id, displayName: m.displayName }))}
        balances={memberIds.map((memberId) => ({
          memberId,
          net: balances.get(memberId) ?? 0,
        }))}
        transfers={transfers}
        yourMemberId={you.id}
      />

      <Separator />

      <MembersSection
        groupId={group.id}
        baseUrl={baseUrl}
        members={members.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          isYou: m.userId === user.id,
          claimToken: m.claimToken,
        }))}
      />

      <Separator />

      <TransactionList
        groupId={group.id}
        currency={group.currency}
        transactions={rows}
      />
    </main>
  )
}
```

- [ ] **Step 7: 🛑 OPERATOR GATE (V3) — verify the whole flow by hand**

With `npm run dev`:

1. Create a group, add Bob and Carol as placeholders.
2. Add a $76.50 dinner paid by you, split three ways. Confirm the summary shows you are owed $51.00 and the settle-up list names Bob and Carol at $25.50 each.
3. Add a $12.00 taxi paid by Bob, split between Bob and Carol only — confirm your balance is unchanged.
4. Click Record on one suggestion, save it, and confirm that balance drops to zero and the transfer disappears.
5. Try to remove a member who has transactions and confirm the refusal message appears.
6. Open the group URL while logged in as an unrelated third user and confirm a 404.

Stop here and wait for the operator to confirm V3 before the final build and commit.

- [ ] **Step 8: Run the whole suite and the production build**

```bash
npm run test:all
npm run build
```

Expected: all tests pass; the build completes with no type errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add group page with balances, settle up, and transactions"
```

---

## Known gaps at the end of this plan

Stated so they read as decisions rather than oversights:

- **No edit UI for transactions.** `updateTransaction` exists and is tested; nothing calls it from the browser. Delete and re-add covers the case.
- **No group rename UI.** `renameGroup` exists and is tested; no control surfaces it.
- **No end-to-end tests,** per the spec — Auth0's hosted login makes them expensive to write now and they would be rewritten after the SMS OTP swap.
- **Concurrent edits are last-write-wins,** per the spec. No version column.
- **`suggestTransfers` is greedy,** not provably minimal. Intentional.

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-07-29-opensplit-design.md`:

- Every spec section maps to a task: data model → 3; money representation and even-split remainder → 1; balances and settlements → 2, 9; Auth0 boundary → 4; authorization and the untrusted-`memberId` rule → 5, 7, 9; claim flow → 8; code structure → the File Structure section; screens → 4, 6, 8, 10; error handling → 5, 9; testing priorities 1–3 → 1–2, 5–9, and the Known Gaps section respectively.
- One deliberate deviation from the spec, flagged here: the spec names `app/api/auth/[auth0]/route.ts` (SDK v3). This plan uses v4's `src/middleware.ts` plus `src/lib/auth0.ts`, which mount `/auth/*` automatically. The boundary property the spec asked for is preserved — two files import the SDK, nothing else does.
- Names are consistent across tasks: `amountMinor`, `shareMinor`, `payerMemberId`, `includedMemberIds`, `occurredAt`, `MAX_AMOUNT_MINOR`, `ActionResult`, `runAction`, `ValidationError`, `NotMemberError`, `requireMembership`, `requireGroupMemberIds`, `pageMembership`, `MemberOption`, `parseAmountToMinor`.
- `formatMoney` is imported by client components and is pure, so it carries no server-only dependency. `splitEvenly` is likewise imported client-side for the live share preview and stays consistent with the server because both call the same function.
