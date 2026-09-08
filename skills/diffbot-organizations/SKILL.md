---
name: diffbot-organizations
description: "Search companies and organizations in the Diffbot Knowledge Graph by industry, headquarters, headcount, revenue, funding raised, ownership, or leadership, plus similarTo lookalike lists for competitor mapping. MUST USE skill when the answer is a list of companies: prospecting, market maps, competitor sets, or who-does-X. Rows are companies, not deals. Triggers on: find companies, list companies, company search, competitors, companies like, startups in, firms, vendors, suppliers, who makes, market map, prospect list, company lookup."
homepage: https://github.com/diffbot/diffbot-openclaw
metadata: {"openclaw": {"emoji": "🏢", "homepage": "https://github.com/diffbot/diffbot-openclaw"}}
---

# Diffbot Organization Search

Find organizations in the Diffbot Knowledge Graph. This is `type:Organization` DQL with the company-research levers pre-selected: industry taxonomy, headquarters vs. offices, headcount and revenue bands, funding, and ownership.

**Prefer the `diffbot_search_organizations` tool.** It builds the query described below from typed parameters, resolves `industry` against the OrganizationCategory taxonomy, handles `similar_to` and `near`, and returns the DQL it ran. Drop to `diffbot_dql` only when the shape is outside those parameters, and use `diffbot_dql_probe` to compare variants first. Token setup is described in $diffbot-dql.

**The organizations/deals boundary is the row shape.** If the rows the user wants are companies, this workflow owns it, including "everything Microsoft acquired", which is a list of target companies. If the rows are transactions, investments, or deals, use $diffbot-deals and `diffbot_search_deals`. Both filter on the same `acquiredBy` and `investments` fields; what differs is what ends up in the table.

Sibling skills: $diffbot-news (articles), $diffbot-people, $diffbot-places (geography), $diffbot-deals (deals as rows). Use $diffbot-dql for products or anything outside these shapes.

## The `diffbot_search_organizations` tool

```
diffbot_search_organizations(industry=["Semiconductor Companies"], country="United States", is_public=True, size=25)
diffbot_search_organizations(similar_to="openai.com", country="United States", size=20)
diffbot_search_organizations(homepage="tesla.com")
diffbot_search_organizations(city="Berlin", facet="categories.name", size=25)
```

| Parameter | Default | Description |
| --- | --- | --- |
| `name` | none | Company name, matched exactly by default (contains-matching over-matches badly). Large companies have duplicate records; the top row is the primary one |
| `name_match` | `strict` | `contains` only when strict returns nothing or the name is a kind of company rather than a specific one |
| `homepage` | none | Homepage domain, e.g. `"tesla.com"`; the most reliable way to pin one company |
| `industry` | none | OrganizationCategory values, OR-ed, e.g. `["Semiconductor Companies"]`. Free text is resolved; ambiguous text returns candidates; unmatched text falls back to `descriptors` |
| `descriptors` | none | Free-text capability tag, e.g. `"GPU"`; the fallback when no industry fits |
| `city` / `region` / `country` | none | Headquarters location (full country name, e.g. `"United States"`) |
| `any_office` | `false` | Match any office in the given location rather than the headquarters |
| `near` | none | Place to search around, e.g. `"Austin"`; use for "near" or "within X miles" |
| `radius` | 15km | Radius for `near`, e.g. `"30mi"` or `"50km"` |
| `min_employees` / `max_employees` | none | Headcount bounds |
| `min_revenue` | none | Minimum annual revenue |
| `is_public` | none | Publicly traded or not |
| `founded_after` / `founded_before` | none | Founding date bounds, `YYYY-MM-DD` |
| `investor` | none | Investor name; returns its portfolio companies |
| `acquired_by` | none | Acquirer name; returns the companies it acquired |
| `similar_to` | none | Anchor company (name or homepage domain) for a lookalike list of exactly `size` companies; other filters narrow within the ranking |
| `sort` | none | `employees`, `revenue`, `founded`, or `importance`. Leave unset unless the ordering is the question |
| `facet` | none | Aggregate into buckets instead of rows, e.g. `"categories.name"`; `size` becomes the bucket count |
| `size` | 10 | Maximum companies (or buckets) |
| `offset` | 0 | Companies to skip, for paging |

At least one filter is required. The response reports a `notes` entry when a filter was silently ignored (hit count equal to the bare `type:Organization` count).

## Step 1 — build the query

Every query starts `type:Organization`. Layer the clauses below.

### Industry — start here

`categories.name` is almost always the best first filter. Look up the exact string before using it in raw DQL; the taxonomy is title-cased and often plural (`"Semiconductor Companies"`, `"Artificial Intelligence Software"`):

```
diffbot_dql_ontology(action="taxonomy", name="OrganizationCategory", search="<regex>")
```

```
type:Organization categories.name:"Semiconductor Companies" isPublic:true
```

When no category fits the niche, fall back to **`descriptors`**, short free-text capability tags:

```
type:Organization descriptors:"GPU"
type:Organization descriptors:"mexican restaurant" near(type:Organization name:"Diffbot")
```

### Location — singular is headquarters, plural is any office

| Use | Meaning |
| --- | --- |
| `location.city.name:"Berlin"` | **Headquartered** in Berlin, the primary location |
| `locations.city.name:"Berlin"` | Has *an* office in Berlin, HQ anywhere (`any_office=true`) |

Prefer the singular form for "companies in X". The same split applies to `name`/`allNames`, `description`/`allDescriptions`, `homepageUri`/`allUris`.

`location` is a `Location` composite: `.city.name`, `.region.name`, `.country.name`, `.subregion.name`, `.metroArea.name`, `.street`, `.postalCode`, `.latitude`, `.longitude`.

### Field reference

| Field | Type | Notes |
| --- | --- | --- |
| `name` / `fullName` | String | Add `strict:` for exact match: `strict:name:"Apple Inc"` |
| `categories` | list | `categories.name`, OrganizationCategory taxonomy |
| `descriptors` | list of String | Free-text capability tags |
| `homepageUri` | URL | Primary domain |
| `nbEmployees` | Integer | Also `nbEmployeesMin`, `nbEmployeesMax`, `nbEmployeeRanges` |
| `revenue.value` / `.currency` | Amount | Also `yearlyRevenues`, `quarterlyRevenues` |
| `isPublic` | Boolean | |
| `ipo` | IPO composite | |
| `stock` | Stock composite | Ticker and exchange |
| `foundingDate` | DDate | `foundingDate>="2020-01-01"` |
| `ceo` | LinkedEntity (Person) | `ceo.name`; absent from the default payload, request with `get:` |
| `founders` | list | `founders.name`; absent from the default payload, request with `get:` |
| `investments` | list | `investments.investors.name`, `investments.series`, `investments.amount.value`, `investments.date` |
| `totalInvestment` | Amount | `totalInvestment.value>100000000` |
| `nbUniqueInvestors` | Integer | |
| `isAcquired` | Boolean | |
| `acquiredBy` | list | `acquiredBy.name` (acquirer), `acquiredBy.amount.value`, `acquiredBy.date` |
| `location` / `locations` | Location | See above |
| `nbLocations` | Integer | |

### Matching a company by name — use `strict:`

`name:"..."` is a **contains** match, and company names are short and repetitive, so it over-matches badly:

| Query | Hits |
| --- | --- |
| `type:Organization name:"Apple"` | 68,068 |
| `type:Organization strict:name:"Apple"` | 1,426 |
| `type:Organization strict:name:"Apple Inc."` | 1 |

When the user names a specific company, reach for `strict:` first (the default `name_match` in `diffbot_search_organizations`) and fall back to the contains form only if it returns nothing. When they mean a *category* of company ("apple growers"), contains is correct, but prefer `categories.name` or `descriptors` for that. The homepage domain (`homepage="apple.com"`) is the most reliable way to pin one company.

`strict:` still leaves duplicates: the KG holds several records for large companies (subsidiaries, regional entities, stale dupes). The default ranking puts the primary record first; take the top row when you need "the" company.

### `near` — companies within a radius of a place

Default radius 15km; override with `mi` or `km`. `near` resolves a single anchor entity: if the inner query matches several, only the first is used.

```
type:Organization categories.name:"Semiconductor Companies" near(type:Place name:"Austin", 30mi)
type:Organization descriptors:"mexican restaurant" near(type:Organization name:"Diffbot")
```

Use this rather than `location.city.name` when the user says "near", "around", or "within X miles"; city-name matching misses the surrounding metro.

### `similarTo` — find companies like this one

Organization-only. Give it an anchor and it returns a ranked list of similar companies: the right tool for "competitors of X", "companies like X", or building a lookalike list.

```
type:Organization similarTo(name:"OpenAI")
type:Organization similarTo(type:Organization homepageUri:"walmart.com")
```

The anchor is a subquery: `name:"..."` is the short form, or use a fuller one like `type:Organization homepageUri:"..."` when the name is ambiguous. `diffbot_search_organizations(similar_to=...)` uses the domain form when the value looks like a domain.

**Other clauses compose and narrow within the similarity search.** They are not a post-filter on the top N, so adding a filter surfaces companies deeper in the ranking rather than just deleting rows:

```
type:Organization similarTo(name:"OpenAI") location.country.name:"United States"
type:Organization similarTo(name:"OpenAI") isPublic:true
```

**It behaves differently from a normal query in two ways:**

- It returns *exactly* `size` results, ranked by similarity. The `hits` field mirrors the size you asked for, so there is no meaningful total; asking for more results just goes further down the ranking.
- **`diffbot_dql_probe` cannot validate it.** A probe runs at size 0, and `similarTo` at size 0 returns 0, which looks like "no matches" but means nothing. Skip Step 2 for `similarTo` queries and validate with a small fetch (`size=10`) instead.

### Subqueries — co-constraining nested fields

Use `{}` when two conditions must hold on the *same* nested object:

```
type:Organization investments.{series:"Series A" date>="2026-01-01"}
```

Without `{}` those are independent: an org with *any* Series A and *any* 2026 round would match, even if they are different rounds. `{}` only works on composite-typed list fields.

### Worked examples

```
type:Organization categories.name:"Semiconductor Companies" isPublic:true
type:Organization categories.name:"Artificial Intelligence Software" location.city.name:"San Francisco"
type:Organization investments.investors.name:"Sequoia Capital"
type:Organization nbEmployees>1000 revenue.value>1000000000
type:Organization isAcquired:true acquiredBy.name:"Microsoft"
type:Organization categories.name:"Artificial Intelligence Software" investments.{amount.value>50000000 date>="2026-01-01"}
type:Organization range:nbEmployees:10-100 location.country.name:"Germany" descriptors:"SaaS"
type:Organization similarTo(name:"OpenAI") location.country.name:"United States"
```

**Distribution questions** ("what industries dominate Berlin startups?") are facets, not row lists: `diffbot_search_organizations(city="Berlin", facet="categories.name", size=25)`, or in raw DQL:

```
type:Organization location.city.name:"Berlin" facet:categories.name
```

Facets require `size` >= 1, and `size` sets the **number of buckets** returned, not rows.

**Leave the sort off unless the user asked for an ordering.** The default ranking already bakes in relevance and prominence, and an explicit sort overrides it, usually for the worse. Measured: `homepageUri:"openai.com"` unsorted returns **OpenAI**, while `revSortBy:nbEmployees` returns *"OpenAI for Developers"*; `anthropic.com` unsorted returns **Anthropic**, sorted returns *"Claude Builder Club"*.

## Step 2 — probe before committing

```
diffbot_dql_probe(queries=[
  'type:Organization descriptors:"GPU" location.country.name:"United States"',
  'type:Organization categories.name:"Semiconductor Companies" location.country.name:"United States"',
  'type:Organization categories.name:"Semiconductor Companies" location.country.name:"United States" isPublic:true'
])
```

Zero hits usually means a mistyped category; re-check with `diffbot_dql_ontology`. A hit count equal to the bare `type:Organization` count means a field path was silently ignored (the tools flag this in `notes`).

**Do not probe `similarTo` queries**; validate those with a small fetch instead.

## Step 3 — fetch and display

`diffbot_search_organizations` returns rows with Company, Description, Employees, Revenue, Currency, City, Country, Website, Public, and Id. The equivalent raw call is:

```
diffbot_dql(query="<DQL>", size=50, fields="name,Company;descriptors,Description;nbEmployees,Employees;revenue.value,Revenue;location.city.name,City;location.country.name,Country;homepageUri,Website;isPublic,Public")
```

`fields` renders only the **primary** value of list/composite fields: one investor, one location. Use `diffbot_dql(query="<DQL> get:name,investments", format="json")` when the user needs full lists; the default JSON payload is not the full entity, and a missing field usually means it was not requested rather than that the data is absent.

**Display**

1. Render a markdown table sized to the question: company, one-line descriptor, headcount, HQ, website.
2. Revenue arrives as a plain number; format it as `$100M` for the user, with its currency.
3. Print the final DQL in a plain code block.
4. Offer more rows (`size`, `offset`) or a refinement.

For `similarTo` results, present them as a ranked list and say what the anchor was: the ordering is the answer, and there is no total count to report.
