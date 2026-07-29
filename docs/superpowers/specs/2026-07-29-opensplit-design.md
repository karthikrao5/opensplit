# OpenSplit — Design

Date: 2026-07-29

## Purpose

A web app for splitting shared expenses. A user creates a group, adds the other
people in it, and records transactions that are divided evenly among a chosen
subset of members. The app reports what each member owes or is owed, and
suggests a short list of payments that settles the group.

## Scope

In scope for this version:

- Auth0 username-password authentication, isolated behind one module so it can
  be replaced with SMS OTP later.
- Groups, each with a name and a single currency.
- Members added as placeholders by any member, claimed later via a link.
- Transactions split evenly across an included subset of members.
- Settlement payments between two members.
- Per-member net balances and suggested transfers to zero the group out.

Explicitly out of scope:

- Uneven splits (percentages, shares, exact amounts).
- Multiple currencies within one group, or currency conversion.
- Receipt images, comments, activity feeds, notifications.
- Roles or per-action permissions beyond group membership.
- Debt simplification across groups.

## Stack

- Next.js (App Router), TypeScript
- shadcn/ui components, Tailwind
- PostgreSQL via Prisma (schema, migrations, typed queries)
- Auth0 (Username-Password connection initially)
- Deployed to Vercel with managed Postgres
- Vitest for tests

## Data model

Five tables. The central decision is that **`GroupMember` is the entity splits
reference, not `User`.** A member may exist with no account attached, which is
what makes placeholder members work without nullable user references spread
through the schema.

```
User
  id           uuid, pk
  externalId   string, unique   -- Auth0 sub
  displayName  string
  createdAt    timestamp

Group
  id           uuid, pk
  name         string
  currency     string           -- ISO 4217, set at creation, immutable
  createdAt    timestamp

GroupMember
  id           uuid, pk
  groupId      fk -> Group, indexed
  displayName  string
  userId       fk -> User, nullable
  claimToken   string, unique, nullable
  createdAt    timestamp
  unique (groupId, userId) where userId is not null

Transaction
  id             uuid, pk
  groupId        fk -> Group, indexed
  kind           enum EXPENSE | SETTLEMENT
  description    string
  amountMinor    int              -- always positive
  payerMemberId  fk -> GroupMember
  occurredAt     timestamp
  createdAt      timestamp

TransactionSplit
  id             uuid, pk
  transactionId  fk -> Transaction, cascade delete, indexed
  memberId       fk -> GroupMember
  shareMinor     int              -- always positive
  unique (transactionId, memberId)
```

### Money representation

All amounts are integers in the currency's minor unit (cents). No floating
point anywhere in the money path. A group has exactly one currency, chosen at
creation; there is no conversion.

### Splits are stored, not derived

Adding a $10.00 expense split three ways writes three `TransactionSplit` rows
of 334, 333, and 333. The invariant `sum(shareMinor) == amountMinor` holds for
every transaction.

Storing shares rather than recomputing them from current membership means a
later membership change cannot silently rewrite the history of past
transactions.

Even division of `amountMinor` across `n` members: each member receives
`floor(amountMinor / n)`, and the remainder `amountMinor - floor(...) * n` is
distributed one minor unit at a time to members ordered by `id`. This is
deterministic and always sums to the exact total.

### Settlements are transactions

A settlement has `kind = SETTLEMENT`, a payer, and exactly one split — on the
recipient, for the full amount. It requires no special handling in the balance
calculation.

### Balances

For member `m`:

```
balance(m) = sum(amountMinor where payerMemberId = m)
           - sum(shareMinor  where memberId = m)
```

A positive balance means the group owes that member. Balances always sum to
zero across a group; this is asserted in tests.

### Claiming a member

A placeholder member has `userId = null` and a unique random `claimToken`.
Visiting `/claim/<token>` while authenticated sets `userId` to the current user
and clears `claimToken`. Tokens are single-use.

The same mechanism covers the eventual Auth0 cutover: issuing a fresh token
re-links an orphaned member row to a new account.

## Authentication and authorization

### Auth0 boundary

`lib/auth.ts` is the only module that imports the Auth0 SDK, aside from the SDK
route handler at `app/api/auth/[auth0]/route.ts`. It exports:

- `getCurrentUser()` — reads the session, finds or creates the `User` row by
  `externalId`, returns it or `null`.
- `requireUser()` — the same, but redirects to login when there is no session.

When SMS OTP replaces username-password, this file changes and the rest of the
app does not. The swap produces new Auth0 `sub` values; because this is
pre-launch, existing test users re-claim their member slots through the
existing claim flow rather than being migrated.

### Authorization

Permissions are flat: any member of a group may add, edit, and delete any
transaction in it, add placeholder members, remove members, and rename the
group. There is therefore exactly one authorization question, answered by one
helper:

```ts
requireMembership(groupId): Promise<{ user, member, group }>
```

It throws `notFound()` when the current user has no `GroupMember` row with
`userId = user.id` in that group — 404 rather than 403, so the existence of a
group is not disclosed to non-members. Every page and Server Action that
touches group data calls it first.

**Member references from the client are never trusted.** Every `memberId` in an
action's input — the payer and each split target — is looked up with
`where: { id, groupId }`. Without this check a request could name a member of
another group.

### Claiming is outside membership

`/claim/<token>` cannot call `requireMembership`, since the point is that the
user is not yet a member. It calls `requireUser()`, looks up the member by
token, and refuses if that user already occupies a slot in the group. The
`unique (groupId, userId)` constraint enforces this at the database level as
well.

### Group creation

Creating a group inserts the `Group` and the creator's `GroupMember` in a
single database transaction, so a group is never memberless.

## Code structure

```
lib/
  auth.ts            Auth0 boundary — getCurrentUser, requireUser
  membership.ts      requireMembership
  db.ts              Prisma client singleton
  money.ts           splitEvenly(amountMinor, memberIds) -> Map<id, share>
                     formatMoney(amountMinor, currency) -> string
  balances.ts        computeBalances(transactions) -> Map<id, net>
                     suggestTransfers(balances) -> [{from, to, amountMinor}]
  actions/
    groups.ts        createGroup, renameGroup
    members.ts       addPlaceholderMember, removeMember, claimMember
    transactions.ts  addTransaction, updateTransaction, deleteTransaction,
                     recordSettlement
```

`money.ts` and `balances.ts` contain pure synchronous functions — no Prisma, no
`async`. They accept plain numbers and member ids and return plain values. This
is where the logic that can actually be wrong lives, and it is testable without
a database.

Server Actions are thin. Each one:

1. calls `requireMembership`
2. validates input with Zod
3. verifies every referenced `memberId` belongs to the group
4. calls the pure function to compute shares
5. writes inside a Prisma transaction
6. calls `revalidatePath`

Actions return `{ ok: true }` or `{ ok: false, error }` rather than throwing, so
forms can render errors.

Pages are async Server Components that query Prisma directly. Client components
are used only where interactivity requires them: the add-transaction dialog and
its member checkbox list.

### suggestTransfers

Greedy minimum-cash-flow: sort debtors and creditors by magnitude, repeatedly
match the largest debtor against the largest creditor, emit a transfer for the
smaller of the two amounts, and continue with the remainder.

This is not provably minimal in all cases — the general problem is NP-hard —
but it is optimal in practice at the scale this app targets. It is intentional,
not a placeholder.

### removeMember

Refuses when the member appears as a payer or in any split, rather than
cascading the deletion. Removing someone who paid for things would corrupt
every balance in the group.

## Screens

All UI uses shadcn components.

- **`/`** — redirects to `/groups` when signed in; otherwise a minimal landing
  page with a login button.
- **`/groups`** — the user's groups, each showing that user's own net position
  in the group. A "New group" dialog collects name and currency.
- **`/groups/[id]`** — the main screen (below).
- **`/claim/[token]`** — "You've been invited as *Bob* in *Trip to Lisbon*" and
  a single button. Redirects to the group on success. Shows an explanatory
  message when the token is unknown, already used, or the user already holds a
  slot in that group.

### Group page layout

A single scrolling column, identical on desktop and mobile, in this order:

1. Header — group name, currency, "Add" button
2. Summary — the current user's net position, then every member's balance
3. Settle up — suggested transfers, each with a "Record" button that opens the
   settlement dialog prefilled
4. Members — count, add-person button, and each member's name with an
   "unclaimed" marker and copyable claim link where applicable
5. Transactions — reverse chronological, each showing date, description, payer,
   amount, and how many ways it was split

### Add-transaction dialog

Fields: amount, description, date, payer (select of group members), and a
checkbox list of members to include, all checked by default. The resulting
per-person share is displayed live as members are toggled.

Recording a settlement uses the same dialog in a reduced form: from, to,
amount, date.

## Error handling

- Server Actions validate with Zod and return `{ ok: false, error }`; forms
  render errors via `useActionState`.
- Rejected inputs: non-positive amount; amount above a fixed ceiling; empty
  included-members list; any `memberId` not belonging to the group.
- A payer who is not included in the split is allowed — this represents one
  member treating the others.
- Missing group and non-member access both produce `notFound()`.
- Concurrent edits are last-write-wins. No optimistic locking or version
  column. This is a deliberate choice for this version.

## Testing

In priority order.

**1. Pure logic (Vitest, no database).** The highest-value tests.

- `splitEvenly` shares sum to the exact amount, including 10¢ across 3 members
  and 1¢ across 5 members
- `splitEvenly` is deterministic for a given member ordering
- `computeBalances` output sums to zero
- `suggestTransfers` output zeroes every balance
- `suggestTransfers` emits at most *n−1* transfers for *n* members

**2. Authorization (integration, against a test Postgres).**

- a non-member calling each action is rejected
- a `memberId` belonging to another group is rejected as payer and as a split
  target
- `removeMember` refuses a member referenced by any transaction
- a claim token cannot be used twice
- a user already holding a slot in a group cannot claim a second one
- creating a group always creates the creator's membership

Tests truncate tables between cases rather than mocking Prisma.

**3. No end-to-end tests in this version.** Driving Auth0's hosted login in a
browser test costs more than it returns now and would be rewritten when SMS OTP
lands. Worth adding once the auth change has settled.
