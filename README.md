# Expense Tracker

A minimalist personal budget and expense tracker built with Next.js, TypeScript
and Tailwind CSS. Set a budget allotment, record expenses, review your history
by date, and export it as a PDF — in Philippine Peso.

The whole app is built on one rule:

```
Current Balance = Budget Allotment − Sum(All Expenses)
```

The balance is never stored. It is derived from the budget and the expense
records on every render, so the dashboard can't drift out of sync with the data.

## Features

- **Dashboard** — current balance, budget allotment, total expenses and expense
  count, with a meter showing how much of the budget is gone.
- **Locked budget** — once saved, the budget is read-only until you explicitly
  unlock it. Lowering it below what you've already spent asks for confirmation.
- **Expense management** — add, edit and delete expenses. Deletions are
  confirmed first, and every change recalculates the totals.
- **Overspending protection** — an expense larger than the available balance is
  blocked, with the shortfall spelled out. Editing an expense measures against
  the balance excluding that expense, so you're never charged for it twice.
- **Persistence** — data is saved to `localStorage` and survives a refresh.
  Corrupted or partially-broken data is repaired rather than crashing the app.
- **Peso formatting** — `Intl.NumberFormat` throughout; money is summed in whole
  centavos so repeated addition never drifts.
- **History** — a dedicated section for previously recorded days, filterable by
  a single date or an inclusive date range, with presets (Today, Yesterday, Last
  7 Days, This Month, Last Month, All Time) and a collapsible daily breakdown.
- **Immutable snapshots** — each day is sealed once it passes, keeping the
  budget and balances that were in effect at the time. Changing today's budget
  or deleting an old expense never rewrites what a past day reported.
- **PDF export** — a real, paginated PDF document (selectable text, repeated
  table headers, page numbers), containing exactly the days the active filter
  selected.
- **Responsive and accessible** — mobile-first, with a bottom-sheet dialog on
  phones, keyboard-navigable controls, focus trapping in dialogs, visible focus
  states and a dark theme that follows the system setting.

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
├── history/page.tsx    # History route
├── error.tsx           # Error boundary with a recovery action
├── not-found.tsx       # 404
├── icon.svg            # Favicon
└── globals.css         # Design tokens, theme, animations

components/
├── dashboard/
│   ├── Dashboard.tsx        # Composes the screen; picks the right state
│   ├── BalanceCard.tsx      # Hero metric + spend meter
│   ├── BudgetCard.tsx       # Budget with lock / unlock / confirm
│   ├── BudgetSetup.tsx      # First-run budget entry
│   ├── ExpenseSummary.tsx   # Total expenses + expense count
│   └── DashboardSkeleton.tsx
├── expenses/
│   ├── ExpenseList.tsx      # List, edit and delete flows
│   ├── ExpenseItem.tsx      # A single row
│   ├── ExpenseFormModal.tsx # Shared add/edit form and validation
│   ├── AddExpenseModal.tsx
│   ├── EditExpenseModal.tsx
│   └── AddExpenseButton.tsx # Floating action button
├── history/
│   ├── HistoryView.tsx      # History screen; filter → results → export
│   ├── HistoryFilterBar.tsx # Presets, single date / range, validation
│   ├── HistorySummaryCard.tsx
│   ├── HistoryDayCard.tsx   # Collapsible day with its recorded figures
│   └── ExportPdfButton.tsx  # Loads the PDF code on demand
├── layout/
│   └── AppShell.tsx         # Page frame + Tracker / History navigation
├── providers/
│   └── TrackerProvider.tsx  # Single source of truth
└── ui/                      # Button, TextField, DateField, Modal, …

lib/
├── calculations.ts     # Totals, balance, sorting — all money maths
├── history.ts          # Day sealing, filtering, summaries, presets
├── validation.ts       # Budget and expense rules
├── currency.ts         # Peso formatting, parsing, rounding
├── storage.ts          # Repository interface + localStorage implementation
├── utils.ts            # Dates, ids, class names
├── pdf/
│   ├── report.ts       # PDF document builder
│   └── font.ts         # Generated font subset (see scripts/)
└── __tests__/          # Unit tests

types/
├── expense.ts          # Tracker domain types
└── history.ts          # History domain types

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

**History is source data, not a view of the current tracker.** This is the rule
the whole history feature turns on: *past days are sealed*. The record for today
is kept in step with the live tracker because the day is still being written, but
any earlier day is frozen exactly as recorded — with the budget and balances that
were in effect at the time.

Rebuilding history from today's budget would be simpler and wrong: lowering your
budget would silently rewrite last week's report, and a PDF exported today would
disagree with the one exported yesterday. So `syncHistory` only ever writes
today's record and passes every earlier day through untouched. It will *add* a
record for a past day that has expenses but was never recorded (self-healing),
but it never overwrites one.

A day is recorded only once something is spent on it. Inventing an empty record
would turn "no activity" into a misleading row of zeroes.

**Summaries do not add up what should not be added.** Expenses are summed across
the period; budgets and balances are point-in-time values, so the starting
figures come from the earliest day in range and the ending balance from the
latest — both read from the snapshots rather than recomputed.

## Stored data

```jsonc
{
  "version": 2,
  "budget": 13000,
  "expenses": [
    {
      "id": "b1e7…",
      "name": "Food",
      "amount": 500,
      "createdAt": "2026-08-17T04:30:00.000Z"
    }
  ],
  // Sealed daily snapshots — the source of truth for History.
  "history": [
    {
      "date": "2026-08-17",
      "budget": 13000,
      "startingBalance": 13000,
      "endingBalance": 12500,
      "totalExpenses": 500,
      "expenses": [
        {
          "id": "b1e7…",
          "name": "Food",
          "amount": 500,
          "createdAt": "2026-08-17T04:30:00.000Z"
        }
      ]
    }
  ]
}
```

Stored under the key `expense-tracker:v2`. On load the payload is validated
field by field: malformed JSON falls back to an empty state, and individual bad
records are dropped or repaired so one bad entry can't break the app. Recorded
budgets and balances are trusted as written — that is the point of a snapshot —
but a missing figure is rebuilt from that record's own expenses.

A `v1` payload (tracker only, no history) is migrated automatically on first
load: history is reconstructed from the expenses that exist, using the only
budget on record. Those days then seal normally, so the approximation happens
once and never drifts.

## Testing

```bash
npm test
```

The suite covers the calculation, currency, validation, history and PDF layers —
the core rule, rounding across many fractional amounts, zero and negative
budgets, the overdraft check, recovery from corrupted or partially-broken saved
data, single-day and inclusive-range filtering, invalid ranges, the immutability
of sealed days, and PDF generation including pagination of large datasets.

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
