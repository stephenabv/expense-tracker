# Expense Tracker

A minimalist personal budget and expense tracker built with Next.js, TypeScript
and Tailwind CSS. Sign up, verify your email, then create budget allotments for
different periods, record expenses against them, review your history by date,
and export it as a PDF — in Philippine Peso.

Every account's data is its own: budgets and expenses are stored in PostgreSQL
against the owner's id, and every query filters on the id resolved from the
session cookie.

A **budget allotment** is one independent financial period: its own name, its
own amount, its own inclusive date range, and its own expenses. It is not a
label on a shared pot.

```
Budget Balance = Budget Amount − Sum(That Budget's Expenses)
```

No balance is ever stored. Every figure is derived from the budgets and the
expense records on each render, so the screen cannot drift from the data.

## Features

- **Accounts** — sign up, log in, log out, verify your email, and reset a
  forgotten password. Passwords are hashed with Argon2id; sessions live in an
  encrypted HTTP-only cookie.
- **Email verification is a prerequisite** — an unverified account cannot log
  in *and* cannot reset its password. Both paths lead back to verification, so
  registering someone else's address never becomes a way into their account.
- **Per-user data** — the tracker, budgets and history are scoped to the signed
  in account. Ownership is enforced in SQL, not by a check that could be
  skipped.
- **Multiple budget allotments** — as many as you need, each with a custom name,
  amount and period. A period can be a single day or an inclusive date range.
- **Independent balances** — each allotment tracks its own spend and remaining
  balance. Nothing one budget does can move another's numbers.
- **Date-driven assignment** — an expense's date decides which allotment pays
  for it. Periods are not allowed to overlap, so that resolution is never a
  guess; when no budget covers a date the app says so and offers to create one
  rather than charging an unrelated allotment.
- **Statuses** — Active, Upcoming, Completed and Over budget, derived from the
  period and the spending.
- **Per-budget locking** — a new allotment is locked; unlocking and editing one
  leaves every other untouched. Completed periods are immutable.
- **Expense management** — add, edit and delete expenses, each with a name,
  amount, date and budget. Deletions are confirmed first.
- **Overspending protection** — an expense larger than *its own* budget's
  balance is blocked, with the shortfall spelled out.
- **History** — filterable by a single date or an inclusive range, with presets,
  grouped by day and labelled with the budget that paid for each day.
- **PDF export** — a real, paginated document with a per-budget summary and a
  day-by-day breakdown, containing exactly the days the filter selected.
- **Persistence** — saved to `localStorage` and migrated forward automatically
  from earlier single-budget versions. Corrupted data is repaired, not fatal.
- **Peso formatting** — `Intl.NumberFormat` throughout; money is summed in whole
  centavos so repeated addition never drifts.
- **Responsive and accessible** — mobile-first, with bottom-sheet dialogs on
  phones, keyboard-navigable controls, focus trapping, visible focus states and
  a dark theme that follows the system setting.

## Tech stack

| Concern    | Choice                       |
| ---------- | ---------------------------- |
| Framework  | Next.js 15 (App Router)      |
| Language   | TypeScript (strict)          |
| Styling    | Tailwind CSS v4              |
| State      | React Context + server actions |
| Auth       | Auth.js (NextAuth v5), Credentials + JWT cookie |
| Hashing    | Argon2id (`@node-rs/argon2`) |
| Database   | PostgreSQL, parameterised SQL |
| Validation | Zod, server-side authoritative |
| Email      | Resend (console fallback in development) |
| PDF        | jsPDF + jspdf-autotable      |
| Tests      | Vitest                       |
| Deployment | Vercel                       |

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL and AUTH_SECRET
npm run db:migrate             # creates the tables
npm run dev
```

Open http://localhost:3000, create an account, and follow the verification link.
Without an email provider configured the link is printed to the server console
instead of being sent — enough to complete the flow locally.

### No Postgres to hand?

Set `DATABASE_URL="pglite://./.pgdata"` and skip `db:migrate`. That runs PGlite,
real Postgres compiled to WASM, inside the server process and creates the schema
on first use. It is a development convenience only: one process owns the data
and nothing else can connect to it.

## Scripts

| Script               | What it does                          |
| -------------------- | ------------------------------------- |
| `npm run dev`        | Start the development server           |
| `npm run build`      | Production build                       |
| `npm start`          | Serve the production build             |
| `npm run db:migrate` | Apply the database schema              |
| `npm run lint`       | ESLint                                 |
| `npm run typecheck`  | `tsc --noEmit`                         |
| `npm test`           | Run the unit and integration tests once|
| `npm run test:watch` | Run the tests in watch mode            |

## Environment variables

Copy `.env.example` to `.env.local`. Nothing secret is committed — `.env` and
`.env*.local` are gitignored, and `.env.example` contains names only.

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `DATABASE_URL` | yes | PostgreSQL connection string. `pglite://<path>` runs the embedded development database instead. |
| `AUTH_SECRET` | yes | Signs and encrypts the session cookie. Generate with `npx auth secret`. |
| `APP_URL` | no | Base URL for the links inside emails. Detected automatically on Vercel. |
| `RESEND_API_KEY` | no | Sends real email. Without it, links are logged to the server console. |
| `EMAIL_FROM` | no | Sender address, required alongside `RESEND_API_KEY`. |
| `DATABASE_POOL_MAX` | no | Connections per instance (default 5). |
| `DATABASE_POOL_IDLE_MS` | no | Idle connection lifetime (default 10000; `0` keeps them open). |

Until `DATABASE_URL` and `AUTH_SECRET` are set the app serves a "Setup required"
page rather than failing with a stack trace.

## Project structure

```
app/
├── layout.tsx              # Root layout, toast provider, metadata
├── page.tsx                # Routes to /tracker or /login
├── login/ signup/          # Public: credentials
├── verify-email/           # Public: redeem or resend a verification link
├── forgot-password/        # Public: request a reset link
├── reset-password/         # Public: redeem a reset link
├── tracker/ budgets/       # Protected
├── history/ profile/       # Protected
├── api/auth/[...nextauth]/ # Auth.js endpoints
├── error.tsx  not-found.tsx
└── globals.css

middleware.ts               # Redirects unauthenticated visitors
auth.ts                     # Auth.js instance (Node runtime)

components/
├── auth/                   # Sign-up, login, reset, resend, checklist, logout
├── dashboard/ budgets/     # Tracker screens
├── expenses/ history/
├── layout/                 # AppShell, SetupRequired
├── providers/              # TrackerData (server) + TrackerProvider (client)
└── ui/

lib/
├── auth/
│   ├── schemas.ts          # Authoritative Zod rules, shared with the forms
│   ├── password.ts         # Argon2id hashing and verification
│   ├── tokens.ts           # CSPRNG tokens, stored only as SHA-256 hashes
│   ├── service.ts          # Register, authenticate, verify, reset
│   ├── auth.config.ts      # Edge-safe half, used by the middleware
│   └── routes.ts           # Which routes are public or protected
├── db/
│   ├── client.ts           # Pool, retries, embedded dev database
│   ├── users.ts            # The only place a password hash is read
│   ├── tokens.ts           # Single-use redemption in one atomic UPDATE
│   └── tracker.ts          # Budgets and expenses, always filtered by user
├── email/                  # Templates and delivery
├── server/
│   ├── auth-actions.ts     # Trust boundary for the auth forms
│   ├── tracker-actions.ts  # Trust boundary for budget/expense writes
│   ├── session.ts          # Resolves the caller from the session cookie
│   └── rate-limit.ts
├── budgets.ts  history.ts  calculations.ts  dates.ts
├── currency.ts  validation.ts  utils.ts
├── pdf/                    # Report builder and generated font subset
└── __tests__/

db/migrations/001_init.sql  # Schema
scripts/migrate.mjs         # npm run db:migrate
types/                      # budget, expense, history, next-auth
```

### Security notes

**Email verification gates both doors.** An unverified account cannot log in,
and cannot reset its password either. Allowing a reset would let whoever
registered an address they do not control take the account over through the
reset flow, bypassing verification entirely — so a reset request for an
unverified address quietly sends a *verification* link instead.

**Passwords.** Argon2id at the OWASP baseline (19 MiB, 2 iterations, 1 lane),
via a vetted implementation rather than anything hand-rolled. A password is
never trimmed or rewritten before hashing, because altering it would change the
secret the user chose. It is never logged, never returned, and the hash is read
by exactly one function (`findUserCredentials`); everything else works with a
public user shape that has no hash on it.

**Tokens.** 256 bits from the CSPRNG, handed to the email once and stored only
as a SHA-256 hash — reading the database cannot verify an address or seize an
account. Redemption is a single conditional `UPDATE` that tests "not expired and
not yet consumed" and marks it consumed in the same statement, so two clicks on
one link cannot both succeed. Verification links last 24 hours, reset links 1
hour, and issuing a new one retires the old.

**Enumeration.** Login answers "Invalid email or password" whether or not the
address exists, and an unknown address still pays for a hash comparison so the
response time does not give it away. Forgot-password and resend-verification
always give the same answer. The one place a duplicate address is named is
sign-up, where the person typed it themselves.

**Sessions.** An encrypted, HTTP-only, SameSite=Lax cookie — no token in
`localStorage` or `sessionStorage`, and nothing readable from `document.cookie`.
Auth.js also supplies CSRF protection on its own endpoints.

**Server-side validation is the only validation that counts.** The forms import
the same Zod schemas purely so the user sees an error immediately; every server
action re-parses its raw input before touching the database. Gender is checked
against a fixed list in the schema *and* by a `CHECK` constraint in the table.

**Data isolation.** Server actions never accept a user id from the client — it
comes from the session cookie, and every statement filters on it. A request
naming another account's budget matches no rows and reads as "not found". This
is covered by tests that have one user try to read, update and delete another's
budgets and expenses.

**Rate limiting.** Fixed-window counters on sign-up, login, verification,
resend, forgot-password and reset. Login is limited per IP *and* per address, so
spreading guesses across clients does not lift the limit. The counters live in
process memory, which means the limit is per instance on a multi-instance
deployment — `lib/server/rate-limit.ts` is where a Redis counter would go, with
no change at the call sites.

### Architecture notes

**Business logic is separate from presentation.** Every figure on screen comes
from `lib/calculations.ts`; no component does its own arithmetic. The validation
rules in `lib/validation.ts` are pure functions with no React dependency, so the
same rules can be reused by a server if one is added.

**The server is authoritative.** The client provider holds a copy of the
signed-in user's budgets and expenses for rendering, but every mutation goes
through a server action that re-validates the request and resolves the owner
from the session. Nothing is written locally and hoped for: if the server
refuses, local state does not change and the reason is shown.

**Only source data is persisted** — the budget and the expense array. Derived
values like the current balance are deliberately not stored.

**Overdraft is a policy, not a hardcoded rule.** `validateExpenseAmount` accepts
an `allowOverdraft` option (default `false`, via
`ALLOW_OVERDRAFT_BY_DEFAULT`). Supporting negative balances later means flipping
that flag rather than reworking the forms.

**Overlapping periods are prevented, not resolved later.** If two allotments
could claim the same day, every expense on that day becomes a question the app
has to ask or guess at. The clash is blocked in the budget form — the one moment
the user can still change the dates cheaply — so expense entry stays unambiguous
forever after. `findOverlaps` reports which budget clashes and on which days.

**Completed budgets are immutable, and that is what guarantees history.** Once a
period has ended its amount, dates and name are frozen. Any report over past
dates is therefore reproducible from source data, so History is *derived* rather
than stored.

This replaced an earlier design that stored sealed daily snapshots. Snapshots
existed because a single global budget could be edited and silently rewrite last
week's report; with date-bounded, immutable periods that risk is gone. Deriving
also fixes a bug snapshots would have introduced here: expenses now carry a
user-settable date, and a back-dated expense must appear in the day it is dated
for — a frozen day record would have hidden it.

Editing an *active* budget's amount does change that allotment's own figures.
That is intended, and the form asks for confirmation when the budget already has
expenses. Narrowing a period so that recorded expenses would fall outside it is
refused outright, since an expense must always sit inside the allotment paying
for it.

**Renaming is safe.** Expenses reference `budgetId`, never the name, so a rename
cannot break an association or a historical record.

**Summaries do not add up what should not be added.** Within one budget, the
balance is a point-in-time value and is never summed across days: the per-budget
`remaining` is the balance as of the last day in range. Across budgets, those
independent pots *are* summed, because separate allotments really do add up to a
total allocated and a total remaining.

## Stored data

PostgreSQL, defined in `db/migrations/001_init.sql`:

```
users                      (id, name, gender, email, password_hash,
                            email_verified_at, created_at, updated_at)
email_verification_tokens  (id, user_id, token_hash, expires_at, consumed_at)
password_reset_tokens      (id, user_id, token_hash, expires_at, consumed_at)
budgets                    (id, user_id, name, amount_centavos,
                            start_date, end_date, locked, …)
expenses                   (id, user_id, budget_id, name, amount_centavos,
                            expense_date, …)
```

Two deliberate choices in the schema:

- **Money is integer centavos**, never a float, so the database cannot
  reintroduce the drift the application already guards against.
- **Calendar dates are `YYYY-MM-DD` text**, not `DATE`. Budget periods and
  expense dates are calendar concepts in the user's timezone; a `DATE` column
  round-tripped through a driver invites an off-by-one-day bug, and zero-padded
  text sorts chronologically anyway.

Email is stored lowercased and trimmed with a unique index, which is what makes
uniqueness case-insensitive and stops two accounts sharing an address even under
a race. Deleting a user cascades to their tokens, budgets and expenses.

Data from the pre-account versions of the app lived in `localStorage` and
belongs to no user, so it is not carried across; that storage layer has been
removed.

## Testing

```bash
npm test
```

The suite runs against a real database: PGlite executes the actual Postgres
engine in-process, so constraints, error codes and SQL semantics behave exactly
as they will in production — the queries under test are the queries that ship.

Alongside the budget, history, currency and PDF coverage, the security-critical
paths are tested directly:

- **Registration** — valid input, every missing or malformed field, duplicate
  email (enforced by the unique index, not a prior `SELECT`), weak passwords,
  mismatched confirmation, gender outside the allowed set, markup and control
  characters in the name.
- **Verification** — a valid token, an unknown one, an expired one, a replayed
  one, and a superseded one; resend saying nothing about unknown or
  already-verified addresses.
- **Login** — verified success, wrong password, unknown address, and the
  unverified account being refused even with the correct password.
- **Password reset** — refused for an unverified account (which receives a
  verification link instead), single-use and superseded tokens, a verification
  token rejected as a reset token, and the old password ceasing to work.
- **Authorization** — one user attempting to read, update and delete another's
  budgets and expenses, and to attach an expense to a budget they do not own.
- **Rate limiting** — limits reached, keys and actions counted separately, and
  the window reopening.

### Regenerating the PDF font

`lib/pdf/font.ts` is generated and checked in, so a normal build needs nothing
extra. jsPDF's built-in fonts are WinAnsi-encoded and have no peso sign, so the
report embeds a DejaVu Sans subset instead — without it every amount would print
as a missing glyph. To rebuild it:

```bash
pip install fonttools
python3 scripts/build-pdf-font.py
```

## Building for production

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Deployment

The app needs a PostgreSQL database and an auth secret before accounts work.

1. Provision Postgres — Neon, Supabase, Vercel Postgres or anything else that
   speaks the protocol.
2. In Vercel → Settings → Environment Variables, set `DATABASE_URL` and
   `AUTH_SECRET` (`npx auth secret` generates one). Add `RESEND_API_KEY` and
   `EMAIL_FROM` to send real email; without them, verification and reset links
   are only written to the server log.
3. Apply the schema once: `DATABASE_URL=... npm run db:migrate`.
4. Deploy.

Every push to the default branch publishes to production, and every pull request
gets its own preview deployment.

Until `DATABASE_URL` and `AUTH_SECRET` are present the deployment serves a
"Setup required" page: the build succeeds and the site stays up, but no account
can be created until they are set.

## Licence

MIT
