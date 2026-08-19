# Expense Tracker

A minimalist personal budget and expense tracker built with Next.js, TypeScript
and Tailwind CSS. Sign up, verify your email, then create budget allotments for
different periods, record expenses against them, review your history by date,
and export it as a PDF — in Philippine Peso.

Every account's data is its own: budgets and expenses are stored in PostgreSQL
against the owner's id, and every query filters on the id resolved from the
session cookie.

A **budget allotment** is an independent source of funds: its own name, its own
amount, and its own expenses. It is not a label on a shared pot. An allotment
either applies to the calendar or it does not:

```
Food Budget       ₱5,000    August 1–5, 2026   (a date range)
Daily Allowance   ₱1,000    August 6, 2026     (a single date)
Emergency Fund   ₱10,000    No Specific Date   (no date restriction)
```

Every expense names the allotment it is deducted from.

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
- **Multiple budget allotments** — as many as you need, each with a custom name
  and amount. An allotment can cover a single date, an inclusive date range, or
  no date at all.
- **General allotments** — a budget with no date restriction is stored with two
  null dates, never sentinel values like `1900-01-01`. It can fund an expense on
  any date and never expires with the calendar.
- **Independent balances** — each allotment tracks its own spend and remaining
  balance. Nothing one budget does can move another's numbers.
- **Explicit expense assignment** — the expense date narrows the options to the
  allotments that can actually fund it (those covering the date, plus every
  general one), and the user picks which pays. One option is selected
  automatically because there is nothing to decide; two or more are never
  resolved for the user. When nothing is available the app says so and offers to
  create a budget rather than charging an unrelated allotment.
- **Safe reassignment** — changing an expense's date re-derives the options and
  drops a budget that no longer applies. Moving an expense between allotments is
  a single write, so it can neither be deducted twice nor fall out of both.
- **Statuses** — Active, Upcoming, Completed, Over budget, and No Date
  Restriction, derived from the applicability and the spending.
- **Per-budget locking** — a new allotment is locked; unlocking and editing one
  leaves every other untouched. Completed periods are immutable.
- **Expense management** — add, edit and delete expenses, each with a name,
  amount, date and budget. Deletions are confirmed first.
- **Overspending protection** — an expense larger than *its own* budget's
  balance is blocked, with the shortfall spelled out.
- **History** — filterable by a single date or an inclusive range, with presets,
  and narrowable to one allotment. Days are grouped and labelled with the budget
  that paid for each.
- **PDF export** — a real, paginated document with a per-budget summary that
  names each allotment's own applicability, and a day-by-day breakdown grouped
  by date and then by budget. It contains exactly what the filter selected.
- **Persistence** — budgets and expenses live in PostgreSQL, scoped to the
  signed-in account, and every mutation is re-validated on the server.
- **Paginated by the database** — the expense list is fetched one page at a
  time, with sorting and filtering applied in SQL, so "highest amount" means the
  highest of everything recorded rather than of whatever page is loaded. Budget
  balances come from grouped aggregates, so they cost one small row per budget
  however many thousands of expenses sit behind them.
- **Loading that says something** — route-level skeletons shaped like the real
  content, action buttons that report progress ("Adding Expense…"), and empty
  states that distinguish "nothing recorded" from "nothing matches this filter".
- **Native-feeling motion** — short transform/opacity transitions on screens,
  modals, sheets, list items and toasts, all collapsed by
  `prefers-reduced-motion`.
- **Versioned** — the footer shows the app name, the current year, the version
  from `lib/app-config.ts` and a seven-character build id.
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

### Using Supabase for the database

Supabase is just PostgreSQL here — this app does not use its JavaScript client,
its data API or its auth service, so `@supabase/supabase-js` and `@supabase/ssr`
are not needed and the publishable/anon key plays no part.

1. Supabase dashboard → **Connect** → **Connection string**.
2. For a serverless deployment such as Vercel, use the **Transaction pooler**
   URI (port `6543`) and set `DATABASE_POOL_MAX=1`, since each function instance
   opens its own pool. For running migrations from your machine, the **Session
   pooler** (port `5432`) is simpler.
3. Put it in `DATABASE_URL` — the password is the database password, which is
   not the same as any API key.
4. Run `npm run db:migrate`.

```bash
DATABASE_URL="postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  npm run db:migrate
```

**Why migration `002` exists.** Supabase serves every table in the `public`
schema over HTTP through PostgREST, and grants its `anon` and `authenticated`
roles table privileges by default. Tables created by a raw SQL migration have
row level security switched **off**. Left alone, that combination would let
anyone holding the browser-facing publishable key read `users.password_hash`,
overwrite it, and list outstanding reset tokens — with the key behaving exactly
as designed, because that key is only ever as safe as the RLS behind it.

So `002_restrict_api_roles.sql` enables RLS on all five tables, defines **no**
policies, and revokes the API roles' privileges outright. The application is
unaffected: it connects directly as the owning role, which bypasses RLS. The
migration is idempotent and a no-op on a Postgres server with no such roles, and
`npm run db:migrate` prints the RLS state of every table so a misconfigured host
is visible immediately.

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
| `SMTP_HOST` | no | SMTP relay host, e.g. `smtp-relay.brevo.com`. |
| `SMTP_PORT` | no | Relay port (default 587). 465 uses implicit TLS; anything else requires STARTTLS. |
| `SMTP_USER` | no | SMTP login. |
| `SMTP_PASSWORD` | no | SMTP key or password. A credential — set it in `.env.local` and in the host's environment, never in the repository. |
| `EMAIL_FROM` | no | Sender address, which the relay must have verified. |
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

**The expense names its budget; nothing infers it.** An earlier version resolved
an expense to an allotment by date, which forced periods not to overlap — with
two candidates the app would have had to guess. Expenses now carry a `budget_id`
chosen at entry, so overlap is a choice rather than a contradiction, and the
no-overlap rule is gone. It had to go: a general allotment covers every day, and
under the old rule it could never have existed alongside anything.

`findOverlaps` survives as advice — the budget form still points out that
another allotment shares those dates — but it no longer blocks. General
allotments are excluded from it, since flagging a budget that applies to every
day would flag every budget the user owns.

**No allotment is ever selected on the user's behalf when there is a choice.**
One eligible budget is filled in automatically and named on screen. If a date
change brings a second into play, even a previously auto-filled selection is
cleared: it was never a decision the user made.

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
`remaining` is the balance as of the last day in range.

Across budgets, *spending* adds up and is labelled "Total Expenses Across
Budgets". A combined **balance** is not offered anywhere — not on the dashboard,
not in the summary card, not in the PDF. ₱3,200 of food money plus ₱8,000 of
emergency money is not ₱11,200 of anything the user can spend, so remaining
balances are only ever reported per allotment.

## Pagination

`lib/pagination.ts` holds the arithmetic — page windows, ranges, clamping — and
both halves of the app read it, so the label under a list can never disagree
with the rows above it.

Two rules are worth knowing:

- **A page size arriving from the client is clamped, never trusted.**
  `?pageSize=1000000` is a request to read the whole table; `MAX_PAGE_SIZE`
  turns it into 100.
- **A page beyond the end is pulled back rather than returned empty.** Narrowing
  a filter must not strand the reader on page 7 of a result set that now has
  one page, so `paginationFor` resolves the page against the real total and any
  change other than the page itself returns to page 1.

History is the one list not paged in SQL. Its rows are *derived* — days with
running balances chained inside each budget — so it fetches the expenses the
filter selected (the filter is the bound, and the server also returns what each
budget spent before the window so the opening balance stays true) and pages the
derived day cards in the browser. The expense list, which is the one that grows
without limit, is paged entirely in the database.

## Stored data

PostgreSQL, defined in `db/migrations/`:

```
users                      (id, name, gender, email, password_hash,
                            email_verified_at, created_at, updated_at)
email_verification_tokens  (id, user_id, token_hash, expires_at, consumed_at)
password_reset_tokens      (id, user_id, token_hash, expires_at, consumed_at)
budgets                    (id, user_id, name, amount_centavos,
                            start_date, end_date, locked, …)
                            -- start_date/end_date are NULL together for an
                            -- allotment with no date restriction
expenses                   (id, user_id, budget_id, name, amount_centavos,
                            expense_date, …)
```

Two deliberate choices in the schema:

- **Money is integer centavos**, never a float, so the database cannot
  reintroduce the drift the application already guards against.
- **A budget period is nullable, and both ends move together.** A CHECK
  constraint enforces `(start_date IS NULL) = (end_date IS NULL)`: a half-set
  period is not a period, and every read path would treat such a row as
  unrestricted — silently discarding the date the user set.
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
   speaks the protocol. On a serverless host, use the provider's connection
   pooler rather than a direct connection (Supabase: the transaction pooler on
   port 6543) and set `DATABASE_POOL_MAX=1`, since every instance opens its own
   pool.
2. In Vercel → Settings → Environment Variables, set `DATABASE_URL` and
   `AUTH_SECRET` (`npx auth secret` generates one). Add the `SMTP_*` variables and
   `EMAIL_FROM` to send real email; without them, verification and reset links
   are only written to the server log.
3. Apply the schema once: `DATABASE_URL=... npm run db:migrate`. This also
   applies migration 002, which keeps the tables off a hosted data API.
4. Deploy.

`main` is the production branch: every push to it publishes to production, and
every pull request gets its own preview deployment. The branch is configured in
Vercel under Settings → Environments → Production → Branch Tracking.

Until `DATABASE_URL` and `AUTH_SECRET` are present the deployment serves a
"Setup required" page: the build succeeds and the site stays up, but no account
can be created until they are set.

## Licence

MIT
