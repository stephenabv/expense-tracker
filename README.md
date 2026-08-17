# Expense Tracker

A minimalist personal budget and expense tracker built with Next.js, TypeScript
and Tailwind CSS. Set a budget allotment, record expenses, and always see the
balance you have left — in Philippine Peso.

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
├── page.tsx            # Dashboard route
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
├── providers/
│   └── TrackerProvider.tsx  # Single source of truth
└── ui/                      # Button, TextField, Modal, ConfirmDialog, …

lib/
├── calculations.ts     # Totals, balance, sorting — all money maths
├── validation.ts       # Budget and expense rules
├── currency.ts         # Peso formatting, parsing, rounding
├── storage.ts          # Repository interface + localStorage implementation
├── utils.ts            # Dates, ids, class names
└── __tests__/          # Unit tests

types/
└── expense.ts          # Domain types
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

## Stored data

```jsonc
{
  "version": 1,
  "budget": 13000,
  "expenses": [
    {
      "id": "b1e7…",
      "name": "Food",
      "amount": 500,
      "createdAt": "2026-01-01T04:30:00.000Z"
    }
  ]
}
```

Stored under the key `expense-tracker:v1`. On load the payload is validated
field by field: malformed JSON falls back to an empty state, and individual bad
records are dropped or repaired so one bad entry can't break the dashboard.

## Testing

```bash
npm test
```

The suite covers the calculation, currency, validation and storage-recovery
layers — the core rule, rounding across many fractional amounts, zero and
negative budgets, the overdraft check, and recovery from corrupted or
partially-broken saved data.

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
