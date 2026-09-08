---
name: diffbot-news
description: "Search news and articles in the Diffbot Knowledge Graph by mentioned company, person, topic, publisher, language, date range, or sentiment. Returns dated, sourced, linkable results, newest first. MUST USE skill for all news, including breaking and developing stories. Use for coverage of an entity over time, sentiment trends, or who said what. Triggers on: news, recent news, latest news, breaking news, headlines, articles about, press coverage, media mentions, coverage of, what's being said about, news sentiment, quotes from."
homepage: https://github.com/diffbot/diffbot-openclaw
metadata: {"openclaw": {"emoji": "📰", "homepage": "https://github.com/diffbot/diffbot-openclaw"}}
---

# Diffbot News Search

Find news articles in the Diffbot Knowledge Graph. This is `type:Article` DQL with news-shaped defaults already chosen: recency sorting, the right narrowing levers, and a display format built for headlines.

**Prefer the `diffbot_search_news` tool.** It builds the query described below from typed parameters (mentions, topic, text, publisher, dates, sentiment, facet), applies the sort rule, resolves `topic` against the ArticleCategory taxonomy, and returns the DQL it ran. Drop to `diffbot_dql` only when the shape is outside those parameters, and use `diffbot_dql_probe` to compare variants first. Token setup is described in $diffbot-dql.

This is the workflow for **all** news requests, breaking events included; the Knowledge Graph's article index updates continuously. Do not hand news off to `diffbot_search_web`. For non-news entity queries use the sibling skills ($diffbot-organizations, $diffbot-people, $diffbot-places, $diffbot-deals), or $diffbot-dql for anything outside those shapes.

## The `diffbot_search_news` tool

```
diffbot_search_news(mentions=["OpenAI"], since="2026-08-01", size=20)
diffbot_search_news(topic="Artificial Intelligence", language="en", size=15)
diffbot_search_news(mentions=["Nvidia"], mention_sentiment_max=-0.3)
diffbot_search_news(mentions=["Anthropic"], facet="siteName", size=15)
```

| Parameter | Default | Description |
| --- | --- | --- |
| `mentions` | none | Entities the article must mention (company, person, product, place), OR-ed. The strongest lever (`tags.label`) |
| `topic` | none | ArticleCategory value, e.g. `"Artificial Intelligence"`. Free text is resolved; ambiguous text returns candidates instead of rows |
| `text` | none | Full-text phrase match on the body; the fallback when no tag or category fits |
| `title` | none | Headline-only phrase match; much tighter than `text` |
| `publisher` | none | Publisher site name, e.g. `"Reuters"` |
| `language` | none | ISO language code, e.g. `"en"` |
| `publisher_country` | none | Publisher's country, full name, e.g. `"Norway"` |
| `quoted_speaker` | none | Articles quoting this person, e.g. `"Sam Altman"` |
| `since` / `until` | none | Publication date bounds, `YYYY-MM-DD` |
| `sentiment_min` / `sentiment_max` | none | Document sentiment bounds, -1 to 1; e.g. `sentiment_max=-0.5` for negative coverage |
| `mention_sentiment_max` | none | Maximum sentiment toward the single entity in `mentions`, for negative coverage of X specifically. Needs exactly one mention |
| `sort` | `newest`, or `relevance` when `since`/`until` is set | `newest`, `relevance`, or `oldest` |
| `facet` | none | `siteName`, `categories.name`, `publisherCountry`, or `date`; aggregates into buckets and `size` becomes the bucket count |
| `size` | 10 | Maximum articles (or buckets) |
| `offset` | 0 | Articles to skip, for paging |

At least one narrowing parameter is required; an unfiltered article query times out. If `mentions` returns zero hits, the tag value did not match an entity name: retry the same words in `text`.

## Step 1 — build the query

Every query starts `type:Article`. Add narrowing clauses, then apply the sort rule.

### The sort rule

| The user's request | Sort clause |
| --- | --- |
| No sort and no date condition | append `sortBy:date` (newest first). **The default**, and what `diffbot_search_news` does when `sort` is unset |
| Names an explicit sort ("most relevant", "highest sentiment") | use that sort; do not add `sortBy:date` |
| Contains a date condition (`date>=`, "in July", "last quarter", "2024") | omit `sortBy:date`; the window already scopes recency, so let relevance ordering pick the best articles inside it (`diffbot_search_news` switches to relevance when `since` or `until` is given) |

`sortBy:date` is ascending by field name but returns newest-first for `date`; use `revSortBy:date` only if the user explicitly wants oldest-first.

### Narrowing levers, in order of preference

1. **`tags.label:"<entity>"`** (the `mentions` parameter): articles that *mention* a KG entity. The strongest lever for "news about X" where X is a company, person, product, or place.
   ```
   type:Article tags.label:"Nvidia" sortBy:date
   ```
   Tag values are entity names; there is no exhaustive list. If a tag returns zero or too few hits, fall back to `text:`.

2. **`categories.name:"<category>"`** (the `topic` parameter): IAB topic taxonomy (459 values), best for subject-matter queries.
   ```
   type:Article categories.name:"Artificial Intelligence" sortBy:date
   ```
   Look up exact names before using them in raw DQL: `diffbot_dql_ontology(action="taxonomy", name="ArticleCategory", search="<regex>")`. `diffbot_search_news` resolves free text itself and returns candidates when it is ambiguous.

3. **`text:"<phrase>"`**: full-text fallback when no tag or category fits.

4. **`title:"<phrase>"`**: headline-only match; much tighter than `text:`.

### Field reference

| Field | Type | Notes |
| --- | --- | --- |
| `date` | DDateTime | Publication date. Compare as `date>="2026-01-01"` |
| `title` | String | Headline |
| `summary` | String | Short abstract. **Use this, not `text` or `html`** |
| `text` / `html` | String | Full body. Huge; never pull into the conversation |
| `siteName` | String | Publisher, e.g. `"Reuters"` |
| `author` | String | Byline |
| `language` | String | ISO code, e.g. `"en"`, `"no"` |
| `publisherCountry` | String | Full country name, e.g. `"Norway"`, not a code |
| `publisherRegion` | String | Macro region, e.g. `"Northern Europe"` |
| `sentiment` | Float | -1 (negative) to +1 (positive) |
| `tags` | list | `tags.label`, `tags.sentiment`, `tags.score`; per-entity sentiment lives here |
| `categories` | list | `categories.name`, `categories.score` |
| `quotes` | list | `quotes.speaker`, `quotes.quote` |
| `pageUrl` | String | Canonical article URL |

### Worked examples

```
type:Article tags.label:"OpenAI" sortBy:date
type:Article categories.name:"Artificial Intelligence" date>="2026-08-01"
type:Article tags.label:"OpenAI" sentiment<-0.5 sortBy:date
type:Article language:"en" tags.label:"Nvidia" date>="2026-08-05"
type:Article quotes.speaker:"Sam Altman" sortBy:date
type:Article tags.label:or("Tesla","Rivian") categories.name:"Automotive" sortBy:date
```

**Entity-specific sentiment.** Document-level `sentiment` scores the whole article. For "negative coverage *of Nvidia specifically*" in an article that also covers others, co-constrain inside the tag with a subquery (`diffbot_search_news` does this from `mentions=["Nvidia"], mention_sentiment_max=-0.3`):

```
type:Article tags.{label:"Nvidia" sentiment<-0.3} sortBy:date
```

### "Who is covering this?" is a facet

For distribution questions (which outlets, which topics, how coverage is spread over time) aggregate rather than listing articles: `diffbot_search_news(mentions=["Anthropic"], facet="siteName", size=15)`, or in raw DQL:

```
type:Article tags.label:"Anthropic" facet:siteName
```

Also useful: `facet:categories.name` (what topics an entity gets covered under), `facet:publisherCountry` (geographic spread), `facet:date` (volume over time; date fields accept `day`, `week`, or `month` interval specifiers).

Facets need `size` >= 1, and `size` sets the **number of buckets**, not rows. Expect noise in `siteName` buckets: aggregators, forums, and mirrors rank alongside newsrooms, so read the top buckets before quoting them.

## Step 2 — probe before committing

```
diffbot_dql_probe(queries=[
  'type:Article tags.label:"Anthropic" sortBy:date',
  'type:Article tags.label:"Anthropic" categories.name:"Artificial Intelligence" sortBy:date',
  'type:Article title:"Anthropic" sortBy:date'
])
```

Aim for a few hundred to a few thousand hits. Zero means the tag or category string is wrong: check the taxonomy or fall back to `text:`.

**Never probe an unfiltered `type:Article`** (or bare `has:` / `language:` filters over the whole corpus). The article index is large enough that these time out.

## Step 3 — fetch and display

`diffbot_search_news` returns rows with Date, Title, Publisher, Author, Sentiment, URL, and Summary, plus the DQL it ran. The equivalent raw call is:

```
diffbot_dql(query="<DQL>", size=25, fields="date.str,Date;title,Title;siteName,Publisher;sentiment,Sentiment;pageUrl,URL")
```

Use `diffbot_dql(query="<DQL> get:title,summary,tags", format="json")` only when a list field must be read in full (every tag with its sentiment). Never relay raw records; read `summary`, not `text`.

**Display**

1. Render a markdown table: **Date | Headline | Publisher | Sentiment**, with the headline linked to the URL.
2. Dates arrive as `2026-08-12T20:02:31`; trim to the day unless the time matters.
3. Print the final DQL in a plain code block so the user can iterate.
4. Offer more results (`size`, `offset`) or a refinement.

To read one article in full, hand its URL to `diffbot_extract` ($diffbot-extract) rather than pulling `text` out of a record.
