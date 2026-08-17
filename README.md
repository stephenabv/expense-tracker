# Expense Tracker

A minimalist personal budget and expense tracker built with Next.js, TypeScript
and Tailwind CSS. Create budget allotments for different periods, record
expenses against them, review your history by date, and export it as a PDF —
in Philippine Peso.

A **budget allotment** is one independent financial period: its own name, its
own amount, its own inclusive date range, and its own expenses. It is not a
label on a shared pot.

```
Budget Balance = Budget Amount − Sum(That Budget's Expenses)
```

No balance is ever stored. Every figure is derived from the budgets and the
expense records on each render, so the screen cannot drift from the data.

## Features

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
| State      | React Context + `useReducer` |
| Storage    | `localStorage` behind a repository interface |
| PDF        | jsPDF + jspdf-autotable      |
| Tests      | Vitest                       |
| Deployment | Vercel                       |

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Scripts

| Script              | What it does                          |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Start the development server           |
| `npm run build`     | Production build                       |
| `npm start`         | Serve the production build             |
| `npm run lint`      | ESLint                                 |
| `npm run typecheck` | `tsc --noEmit`                         |
| `npm test`          | Run the unit tests once                |
| `npm run test:watch`| Run the unit tests in watch mode       |

## Environment variables

**None.** The app runs entirely in the browser and stores its data in
`localStorage`, so there is nothing to configure and no secrets to keep. No
`.env` file is needed for local development or for deployment.

If you later swap the storage layer for a hosted database (see below), add the
credentials as Vercel environment variables and read them server-side — never
commit them, and never expose them through a `NEXT_PUBLIC_` variable.

## Project structure

```
app/
├── layout.tsx          # Root layout, providers, metadata
├── page.tsx            # Tracker route
├── budgets/page.tsx    # Budgets route
├── history/page.tsx    # History route
├── error.tsx           # Error boundary with a recovery action
├── not-found.tsx       # 404
├── icon.svg            # Favicon
└── globals.css         # Design tokens, theme, animations

components/
├── dashboard/
│   ├── Dashboard.tsx        # Tracker screen; first-run, loading, active
│   ├── CurrentBudgetCard.tsx# The allotment covering today
│   ├── BudgetOverview.tsx   # "Your Budgets" at-a-glance list
│   └── DashboardSkeleton.tsx
├── budgets/
│   ├── BudgetsView.tsx      # Create, review and manage allotments
│   ├── BudgetCard.tsx       # One allotment's terms and balance
│   ├── BudgetFormModal.tsx  # Create / edit, with the overlap guard
│   ├── BudgetDetailModal.tsx
│   └── BudgetStatusBadge.tsx
├── expenses/
│   ├── ExpenseList.tsx      # List, edit and delete flows
│   ├── ExpenseItem.tsx      # A single row, labelled with its budget
│   ├── ExpenseFormModal.tsx # Name, amount, date, budget + validation
│   ├── AddExpenseModal.tsx
│   ├── EditExpenseModal.tsx
│   └── AddExpenseButton.tsx # Floating action button
├── history/
│   ├── HistoryView.tsx      # Filter → results → export
│   ├── HistoryFilterBar.tsx # Presets, single date / range, validation
│   ├── HistorySummaryCard.tsx
│   ├── HistoryDayCard.tsx   # Collapsible day, named by budget
│   └── ExportPdfButton.tsx  # Loads the PDF code on demand
├── layout/
│   └── AppShell.tsx         # Page frame + Tracker / Budgets / History nav
├── providers/
│   └── TrackerProvider.tsx  # Single source of truth
└── ui/                      # Button, TextField, DateField, SelectField, …

lib/
├── calculations.ts     # Totals, balances, sorting — all money maths
├── dates.ts            # Calendar-day keys, ranges, overlap detection
├── budgets.ts          # Status, per-budget summaries, date resolution
├── history.ts          # Derived day records, filtering, summaries
├── validation.ts       # Budget and expense rules
├── currency.ts         # Peso formatting, parsing, rounding
├── storage.ts          # Repository interface + localStorage implementation
├── utils.ts            # Dates, ids, class names
├── pdf/
│   ├── report.ts       # PDF document builder
│   └── font.ts         # Generated font subset (see scripts/)
└── __tests__/          # Unit tests

types/
├── budget.ts           # Budget allotment types
├── expense.ts          # Expense types
└── history.ts          # History reporting types

scripts/
└── build-pdf-font.py   # Regenerates lib/pdf/font.ts
```

### Architecture notes

**Business logic is separate from presentation.** Every figure on screen comes
from `lib/calculations.ts`; no component does its own arithmetic. The validation
rules in `lib/validation.ts` are pure functions with no React dependency, so the
same rules can be reused by a server if one is added.

**The data layer is swappable.** Components never touch `localStorage`. They go
through `TrackerRepository` (`lib/storage.ts`), whose methods are async so that
replacing the browser implementation with an API client is a drop-in change:

```ts
const remoteRepository: TrackerRepository = {
  async load() { return (await fetch("/api/tracker")).json(); },
  async save(state) { await fetch("/api/tracker", { method: "PUT", body: JSON.stringify(state) }); },
  async clear() { await fetch("/api/tracker", { method: "DELETE" }); },
};

<TrackerProvider repository={remoteRepository}>…</TrackerProvider>
```

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

```jsonc
{
  "version": 3,
  "budgets": [
    {
      "id": "b1e7…",
      "name": "August Week 1",
      "amount": 5000,
      "startDate": "2026-08-01",   // inclusive
      "endDate": "2026-08-05",     // inclusive; equals startDate for one day
      "createdAt": "2026-08-01T02:00:00.000Z",
      "updatedAt": "2026-08-01T02:00:00.000Z",
      "locked": true
    }
  ],
  "expenses": [
    {
      "id": "9f2c…",
      "budgetId": "b1e7…",         // by id, so renaming is safe
      "name": "Food",
      "amount": 500,
      "expenseDate": "2026-08-01", // decides which budget applies
      "createdAt": "2026-08-01T04:30:00.000Z",
      "updatedAt": "2026-08-01T04:30:00.000Z"
    }
  ]
}
```

Stored under the key `expense-tracker:v3`. Only source data is persisted —
balances, statuses and the whole of History are derived on demand.

On load the payload is validated field by field: malformed JSON falls back to an
empty state, a budget with no usable period is dropped, a reversed period is
repaired, and an expense pointing at a budget that no longer exists is discarded
rather than left with no balance to belong to.

A `v1` or `v2` payload (one global budget, no periods) is migrated on first
load into a single allotment named **Original Budget**, spanning the days the
old tracker covered and staying open through today. Every existing expense is
attached to it. Rename or re-scope it like any other budget.

## Testing

```bash
npm test
```

The suite covers the date, budget, calculation, currency, validation, history
and PDF layers — per-budget balances and their independence from one another,
statuses, overlap detection including shared endpoints, single-day and
inclusive-range periods, date-to-budget resolution (and the refusal to resolve
when several budgets match), rounding across many fractional amounts, the
overdraft check, migration from the single-budget formats, recovery from
corrupted data, filtering, and PDF generation including pagination of large
datasets.

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

The app deploys to Vercel with no configuration beyond the defaults.

1. Push this repository to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Vercel detects Next.js and fills in the build settings; `vercel.json` pins
   them explicitly. There are no environment variables to add.
4. Deploy.

Once the repository is connected, deployments are automatic: every push to
`main` publishes to production, and every pull request gets its own preview
deployment.

## Licence

MIT
