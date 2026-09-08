---
name: diffbot-web-search
description: "Use for any web search, documentation search, or research request not falling under the DQL categories (news, organizations, people, places, deals). Returns ranked results with relevance scores, publication dates, and relevant chunks per result in one call. ALSO USE before calling any built-in fetch tool on a public URL: querying `url:<URL>` reads Diffbot's already-parsed copy of that page from the Web Index in ~300ms, and works on pages that block a live fetcher. Best for reference prose (docs, articles, papers); fetch live when the page's current state is the question (status, prices, versions, feeds) or the URL is an API endpoint, raw file, or PDF. Not for news: $diffbot-news is a stronger tool and its article index is continuously updated. Triggers on: web search, search the web, search online, find web pages, look up online, find the url for, official site for, documentation for, docs for, how to, read this page, what does this link say, open this URL, summarize this page."
homepage: https://github.com/diffbot/diffbot-openclaw
metadata: {"openclaw": {"emoji": "🔎", "homepage": "https://github.com/diffbot/diffbot-openclaw"}}
---

# Diffbot Web Search

Search the live web with the `diffbot_search_web` tool. It returns ranked results with relevance scores, URLs, publication dates, and the relevant chunk of each page's content in a single call.

The plugin needs a Diffbot token: set `plugins.entries.diffbot.config.apiToken` in openclaw.json, or `DIFFBOT_API_TOKEN` in the environment, or a `DIFFBOT_API_TOKEN=...` line in `~/.diffbot/credentials`. Free tokens at https://app.diffbot.com/get-started. There is nothing to install; the plugin calls Diffbot over HTTP.

Use this for general web and documentation research. For Knowledge Graph entities, prefer the specific tools: `diffbot_search_news`, `diffbot_search_organizations`, `diffbot_search_people`, `diffbot_search_places`, `diffbot_search_deals` ($diffbot-news, $diffbot-organizations, $diffbot-people, $diffbot-places, $diffbot-deals).

## Before any built-in fetch: try the index

You are about to call a web-fetch tool, `curl`, or a browser tool on a public URL. Query the index first. Diffbot already crawled and parsed that page, so a `url:` prefix returns its stored copy as a **single-record array** in ~300 ms (2-6 ms server-side):

```
diffbot_search_web(query="url:https://example.com/docs/api")
```

Put what you want to know after the URL. `url:` pins the result to that page; the rest of the query selects which chunks of it come back:

```
diffbot_search_web(query="url:https://example.com/docs/api rate limits retry-after header")
```

### The rule

**Does your answer depend on what the page says, or on what it says *right now*?** Prose -> index. Current state -> fetch it live (with `diffbot_extract`, or the client's own fetch tool for non-page URLs).

A cached copy is a snapshot with no visible timestamp. That is a fair trade for a document that was published once, and a bad one for a page whose whole purpose is to change.

### Where the index wins

| Situation | Why |
| --- | --- |
| **Reference prose**: docs, articles, papers, blog posts, spec and product pages, wikis | Written once, read many times. The snapshot *is* the page |
| **The fetcher is blocked** | Measured: a built-in fetch on `reddit.com` -> *"unable to fetch"*; on `x.com` -> *HTTP 402*. The index returned a record for both |
| **The URL redirects** | A built-in fetch on `docs.anthropic.com/.../prompt-caching` returned a 301 and required a second call to the new host. `url:` on the original URL returned 4.3 KB of content, first try |
| **Context cost** | `url:<URL> <terms>` returns the matching chunks. A built-in fetch pulls the whole page, and many harnesses pass it through a summarizer, so you get a paraphrase you can't quote |

### Where a live fetch wins — use it, don't force the index

| Situation | Evidence |
| --- | --- |
| **It isn't a page**: JSON/API endpoints, raw `.md`/`.txt`, `robots.txt`, PDFs | All four **miss** the index. `api.github.com/repos/...` missed; a live fetch answered it correctly with current values |
| **Current state is the question**: status, prices, versions, live counts, dashboards | `status.anthropic.com` is cached as "All Systems Operational" with no date attached. Reporting that as current status is a real error |
| **Feeds, homepages, listings**: anything whose content is "the latest N" | `techcrunch.com` is cached as a **June 2025** snapshot whose "Latest News" is over a year stale |
| **Version-sensitive answers** | The cached `prompt-caching` page still describes Claude 4 models. Right shape, superseded specifics |
| **Private, authenticated, localhost, intranet** | Never crawled. Not in the index, by design |
| **`search_results` is empty** | The URL isn't indexed. Costs ~300 ms to rule out, then fetch with `diffbot_extract` |

### `date` is not a freshness signal

Do not read it as "cached at". Measured on `url:` hits: the arXiv abstract page returns `2017` (its publication date), the prompt-caching docs page returns `Jun 2023`, and Reddit and the status page return **no date at all**. Nothing in the response tells you when the copy was taken, which is exactly why the rule above keys on the *kind of page* rather than on a timestamp.

### Reading the result

`search_results` holds **exactly one** element on a hit, **zero** on a miss. There is no ranking to weigh: `score` reflects the term match, not the URL match, so a lone record at 0.368 is still a clean hit. URL matching normalizes `http`/`https`, a missing scheme, and a missing trailing slash to the same record.

`content` is chunks, not the document: ~1.1 KB for `url:<URL>` alone (the page's opening), ~4-6 KB when you add query terms. Never present it as the full page. When you need the whole document (every row of a table, a full changelog, a complete spec) or when a chunk breaks off at the part you need (the API marks a cut with a literal `...`), that is what `diffbot_extract` ($diffbot-extract) is for.

## The `diffbot_search_web` tool

```
diffbot_search_web(query="<query>", num_results=N, max_tokens=M)
```

| Parameter | Default | Description |
| --- | --- | --- |
| `query` | required | The search text. Prefix with `url:<URL> ` to read one known page from the index; the words after the URL select which chunks of it come back |
| `num_results` | 10 | Number of results to return. Prefer this over `max_tokens` to shrink a response |
| `max_tokens` | none | Caps total response tokens; trims from the bottom of the ranking |

`max_tokens` degrades sharply: measured on one query, 5000 -> 10 results, 2000 -> 5, 1000 -> 1, and **200 -> zero**. Below roughly 1000 the budget cannot fit a single result, so treat an empty result set as a possible budget artifact rather than "nothing found". Prefer `num_results` when you just want fewer results.

## Result fields

Each result in the `search_results` array contains:

| Field | Description |
| --- | --- |
| `score` | Relevance score (0-1); `>0.85` is excellent, `0.7-0.85` good, `0.5-0.7` fair |
| `title` | Page title |
| `pageUrl` | URL |
| `date` | RFC 2822 date: usually the publication date, sometimes absent, and never a "cached at" timestamp |
| `content` | Relevant chunk(s) of the page's text (may be markdown) |

Ranking favors primary sources over secondary ones, so one call usually answers the question with a citable source.

**`content` is a chunk, not always the whole page.** It is selected for relevance to the query, so one call usually answers the question outright; don't reflexively fetch the page as a second step.

Reach for `diffbot_extract` on the result's `pageUrl` only when the chunk or its metadata *implies the answer is elsewhere on the page*: the chunk cuts off mid-section, it references a table, changelog, pricing tier, or API parameter it doesn't itself contain, or the title and score look right while the returned text covers a different part of the page. A cheaper first move is to re-query `url:<that pageUrl> <the missing thing>`; it pulls different chunks from the same page for another ~300 ms index hit. When you do extract, extract one promising URL rather than the whole result set.

## Tips

- Scores above 0.7 are generally trustworthy; below 0.5 suggests the result is loosely related.
- Reaching for the built-in fetch tool is the moment to run a `url:` lookup instead: ~300 ms, and it clears bot walls and redirects that stop a live fetcher. Fetch live when the page's current state is the question, when the URL isn't a page (API, raw file, PDF), or when the lookup comes back empty.
- For news and articles, use `diffbot_search_news` ($diffbot-news) instead; the Knowledge Graph's article index is continuously updated and returns dated, sourced, structured results.
