---
name: diffbot-deals
description: "Search funding rounds, investments, and acquisitions in the Diffbot Knowledge Graph by date, deal size, round series, investor, acquirer, or industry. Returns deals as rows: target, counterparty, amount, currency, date. MUST USE skill when the answer is a list of deals: deal flow, funding history for a company, or an investor's recent activity. Rows are deals, not companies. Triggers on: funding rounds, raised, Series A, venture funding, funding history, deal flow, deal size, investments in, acquisitions, M&A, acquired for, valuation round."
homepage: https://github.com/diffbot/diffbot-openclaw
metadata: {"openclaw": {"emoji": "💸", "homepage": "https://github.com/diffbot/diffbot-openclaw"}}
---

# Diffbot Deal Search

Find funding rounds, acquisitions, and transactions in the Diffbot Knowledge Graph. Deals live in two places: as standalone `Investment`/`Transaction` records, and as fields hanging off the `Organization` involved. **Choosing the right one is the whole skill**; see the routing table below.

**Prefer the `diffbot_search_deals` tool.** Its `kind` parameter applies the routing table, an `industry` filter is moved to the company side automatically, amounts and dates are normalized, and it returns the DQL it ran. Drop to `diffbot_dql` only when the shape is outside those parameters. Token setup is described in $diffbot-dql.

**First, check the row shape.** This workflow is for when the rows are deals: target, acquirer/investors, amount, date, series. If the rows the user wants are *companies* ("everything Microsoft acquired", "companies Sequoia backed"), use $diffbot-organizations and `diffbot_search_organizations`; it filters on the same `acquiredBy` and `investments` fields but presents companies.

Sibling skills: $diffbot-organizations (companies as rows), $diffbot-news, $diffbot-places. Use $diffbot-dql for anything outside these shapes.

## The `diffbot_search_deals` tool

```
diffbot_search_deals(investor="Sequoia Capital", sort="newest", size=20)
diffbot_search_deals(series="Series A", since="2026-01-01", sort="largest")
diffbot_search_deals(kind="funding", industry="Artificial Intelligence Software", min_amount=50000000, since="2026-01-01")
diffbot_search_deals(kind="acquisitions", acquirer="Microsoft", sort="largest")
diffbot_search_deals(since="2026-01-01", facet="series", size=12)
```

| Parameter | Default | Description |
| --- | --- | --- |
| `kind` | `funding` | `funding` for rounds (`type:Investment`), `acquisitions` for M&A (`Organization.acquiredBy`), `any` for every transaction type (`type:Transaction`) |
| `company` | none | The company raising or being acquired |
| `investor` | none | Investor name for funding rounds, e.g. `"Sequoia Capital"`. Not for `acquisitions` (use `acquirer`) |
| `acquirer` | none | Acquirer name for acquisitions, e.g. `"Microsoft"` |
| `series` | none | Round series, e.g. `"Series A"`; contains-matched, so it also covers `"Series A-1"`. `funding` only |
| `min_amount` / `max_amount` | none | Deal size bounds, e.g. `50000000` |
| `currency` | `USD` | Currency for the amount filter; values are not normalized across currencies |
| `since` / `until` | none | Deal date bounds, `YYYY-MM-DD` |
| `industry` | none | OrganizationCategory of the company, e.g. `"Artificial Intelligence Software"`. Free text is resolved; ambiguous text returns candidates. `funding` or `acquisitions` only; does not combine with `facet` |
| `sort` | none | `newest` or `largest`. Leave unset unless the ordering is the question; unsorted results surface the headline deals |
| `facet` | none | `series` (funding only), `investors` (most active investors or acquirers), or `amount` (auto-bucketed deal sizes); `size` becomes the bucket count |
| `size` | 10 | Maximum deals (or buckets) |
| `offset` | 0 | Deals to skip, for paging |

At least one filter is required. With `kind="funding"` and `industry` set, `hits` counts companies in the industry with a matching round and `results` lists each matching round per company, with every investor.

## Step 1 — route the question

| The user asks about | Query | `kind` | Why |
| --- | --- | --- | --- |
| Funding rounds by date, size, series, or investor | `type:Investment` | `funding` | One row per round, with amount, series, date, investors |
| Deals in an **industry / location / company-size** segment | `type:Organization` + `investments.{...}` | `funding` + `industry` | Industry lives on the company, not the deal; see the gap below |
| Acquisitions ("who bought X", "everything Microsoft acquired") | `type:Organization isAcquired:true acquiredBy.name:"..."` | `acquisitions` | `Acquisition` records are name-only stubs |
| Any money movement, not just equity | `type:Transaction` | `any` | Superset: `Investment` and `Acquisition` are both subtypes |

### The industry gap — read this before filtering deals by sector

`investee` on an `Investment` is a `LinkedEntity`, which carries only `name`, `types`, `summary`, `image`, `diffbotUri`. It has **no `categories`**, so `investee.categories.name:"..."` returns zero; it looks like "no such deals" rather than "no such field."

Flip the query to the company side instead, and use `{}` so the round's conditions co-constrain:

```
type:Organization categories.name:"Artificial Intelligence Software" investments.{amount.value>50000000 date>="2026-01-01"}
type:Organization categories.name:"Artificial Intelligence Software" investments.{series:"Series A" date>="2026-01-01"}
```

Without `{}` the clauses are independent: a company with *any* $50M round and *any* 2026 round matches, even if they are different rounds. `diffbot_search_deals(kind="funding", industry=..., ...)` builds this form and lists only the rounds that match.

## Step 2 — field reference

**`type:Investment`** — a funding round.

| Field | Type | Notes |
| --- | --- | --- |
| `investee` | LinkedEntity (Organization) | `investee.name`, the company raising |
| `investment.series` | String | `"Series A"`, `"Series B"`, `"Series Unknown"`, ... |
| `investment.amount.value` | Float | Raw number; pair with `.currency` |
| `investment.amount.currency` | String | `"USD"`, ... **Always filter or display currency**; values are not normalized |
| `investment.date` | DDate | `investment.date>="2026-01-01"` |
| `investment.investors` | list of LinkedEntity | `investment.investors.name` |
| `date`, `name`, `amount` | | Inherited from `Transaction`; `date` mirrors `investment.date` |

**`type:Transaction`** — any transaction; `Investment` and `Acquisition` are subtypes (filter with `types:"Acquisition"`).

| Field | Notes |
| --- | --- |
| `payee` | LinkedEntity (Organization), receiving side |
| `payers` | list of LinkedEntity, paying side |
| `amount.value` / `amount.currency` | |
| `date` | DDate |
| `name` | e.g. `"Venture Round - OpenAI"` |

**`Organization.acquiredBy`** — the reliable path for M&A.

| Field | Notes |
| --- | --- |
| `acquiredBy.name` | The acquirer |
| `acquiredBy.amount.value` | Deal size |
| `acquiredBy.date` | |
| `isAcquired` | Boolean flag on the target |

Also on Organization: `investments` (full round history), `totalInvestment.value`, `nbUniqueInvestors`.

**Sorting.** There *is* a useful default: unsorted, `investment.investors.name:"Sequoia Capital"` returns the headline rounds (OpenAI $122B, Anthropic $50B, OpenAI $40B), whereas `revSortBy:investment.date` returns whatever closed most recently regardless of size. Leave the sort off unless the ordering is the question, then use:

```
revSortBy:investment.date         # newest rounds first  (sort="newest")
revSortBy:investment.amount.value # largest rounds first (sort="largest")
```

### Worked examples

```
type:Investment investment.investors.name:"Sequoia Capital" revSortBy:investment.date
type:Investment investment.series:"Series A" investment.date>="2026-01-01" revSortBy:investment.amount.value
type:Investment investment.amount.value>100000000 investment.amount.currency:"USD" revSortBy:investment.date
type:Investment investee.name:"OpenAI" revSortBy:investment.date
type:Organization isAcquired:true acquiredBy.name:"Microsoft" revSortBy:acquiredBy.amount.value
type:Organization categories.name:"Semiconductor Companies" investments.{amount.value>100000000 date>="2025-01-01"}
type:Transaction types:"Acquisition" sortBy:date
```

**Note on `type:Acquisition`.** These records exist (~209k) but are near-empty stubs, typically just a `name` like `"Reliance Motor Car Company acquired by General Motors"`, with `date`, `amount`, `payee`, and `payers` all null. Don't build a deal table from them; route acquisitions through `Organization.acquiredBy`.

### Distribution questions are facets, not row lists

"What stage is most funding at?", "which investors are most active?": aggregate instead of listing, with `diffbot_search_deals(since="2026-01-01", facet="series", size=12)` or in raw DQL:

```
type:Investment investment.date>="2026-01-01" facet:investment.series
```

Returns buckets like `Seed 4568, Grant 3796, Series A 2061, Debt Financing 2015, Pre Seed 1965`. Also useful: `facet:investment.investors.name` (most active investors), `facet:investment.amount.value` (auto-bucketed deal sizes).

Facets need `size` >= 1, and `size` sets the **number of buckets**, not rows. A facet response has `value`/`count` per bucket, not entities, so don't use it when the user wants individual deals.

**`or()` is usually unnecessary on `series`.** `investment.series:"Series A"` is a contains match and already covers `"Series A-1"`; `or("Series A","Series A-1")` returns the identical count. Reach for `or()` only across genuinely different strings.

## Step 3 — probe before committing

```
diffbot_dql_probe(queries=[
  'type:Investment investment.series:"Series A" investment.date>="2026-01-01"',
  'type:Investment investment.amount.value>100000000',
  'type:Organization categories.name:"Artificial Intelligence Software" investments.{amount.value>50000000 date>="2026-01-01"}'
])
```

Zero hits on an `investee.<something>` path almost always means the field doesn't exist on `LinkedEntity`; re-read the gap above rather than loosening the filter.

## Step 4 — fetch and display

`diffbot_search_deals` returns rounds as Company, Round, Amount, Currency, Date, Lead Investor, Id, and acquisitions as Target, Acquirer, Amount, Currency, Date, Industry, Id. The equivalent raw calls:

```
diffbot_dql(query="<DQL>", size=50, fields="investee.name,Company;investment.series,Round;investment.amount.value,Amount;investment.amount.currency,Currency;investment.date.str,Date;investment.investors.name,Lead Investor")
diffbot_dql(query="<DQL>", size=50, fields="name,Target;acquiredBy.name,Acquirer;acquiredBy.amount.value,Amount;acquiredBy.date.str,Date;categories.name,Industry")
```

A column spec renders only the **primary** value of a list field, so the row shows one investor even when a round had thirty. When the full investor list matters, read the records as JSON: `diffbot_dql(query="<DQL> get:investee,investment", format="json")`. The industry-routed form of `diffbot_search_deals` already lists every investor per matching round.

**Display**

1. Render a markdown table: **Date | Company | Round | Amount | Investors**.
2. **Reformat amounts.** Values arrive as plain numbers (`300000000`); show `$300M`. Never present a bare number without its currency.
3. Dates are already trimmed to `2026-07-23`.
4. Blank amount means the round was reported without a disclosed size; label it "undisclosed", not `0`.
5. `"Series Unknown"` is a real value in the data, not a lookup failure.
6. Print the final DQL in a plain code block and offer more rows (`size`, `offset`) or a refinement.
