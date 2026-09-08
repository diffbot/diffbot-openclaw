---
name: diffbot-extract
description: "Extract markdown or structured content from a URL using the Diffbot Extract API, a live fetch and parse of the page, seconds per call. Try $diffbot-web-search with `url:<URL>` first: it reads Diffbot's already-extracted copy from the Web Index in ~300ms and answers most page questions outright. Use this skill when that lookup misses (URL not indexed) or when you need the complete document rather than the relevant chunks. Triggers on: extract URL, fetch page, parse webpage, get content from URL, extract article, extract structured data, full page text, whole article."
homepage: https://github.com/diffbot/diffbot-openclaw
metadata: {"openclaw": {"emoji": "🧬", "homepage": "https://github.com/diffbot/diffbot-openclaw"}}
---

# Diffbot Extract

Extract structured content from any URL with the `diffbot_extract` tool. It returns a clean markdown rendering of the page by default, or the full structured JSON on request, classifying the page (article, product, discussion, ...) on the way. Use it instead of a raw web fetch, which returns HTML and consumes far more tokens.

The plugin needs a Diffbot token: set `plugins.entries.diffbot.config.apiToken` in openclaw.json, or `DIFFBOT_API_TOKEN` in the environment, or a `DIFFBOT_API_TOKEN=...` line in `~/.diffbot/credentials`. Free tokens at https://app.diffbot.com/get-started. There is nothing to install; the plugin calls Diffbot over HTTP.

## First: is a live fetch actually needed?

Extract is a **live retrieval**: it fetches and parses the page on demand. Measured: 1.3 s to 9 s for most URLs, 24 s cold for one docs page (0.8 s on a repeat). That is the cost of going to the origin.

Diffbot has usually already parsed the page, and that copy is one index lookup away:

```
diffbot_search_web(query="url:<URL> <what you want to know>")
```

~300 ms, one record back, and the chunks matching your terms. See $diffbot-web-search, which also covers when a cached copy is *not* safe to trust. Run it first for any public URL, the same way you would before reaching for a built-in fetch tool or `curl`. Come back here when:

- `search_results` came back **empty**: the URL isn't indexed (too new, paywalled, private, behind a login), so live retrieval is the only option;
- you need the **whole document**, not the ~4-6 KB of chunks the index lookup returns: every row of a table, a full changelog, an entire spec, license, or transcript (that docs page: 4.3 KB of chunks from the index, 25.5 KB of text from Extract);
- the page's **current state** is the question: a status page, a feed, a price, a version number, where a snapshot of unknown age is worse than no answer;
- you need Extract-only fields the search index doesn't carry: `author`, `images`, `links`, `tags`, `sentiment`, or a typed `product`/`discussion` parse.

## The `diffbot_extract` tool

```
diffbot_extract(url="https://example.com/article")
diffbot_extract(url="https://example.com/product-page", page_type="product", format="json")
```

| Parameter | Default | Description |
| --- | --- | --- |
| `url` | required | The page to fetch. The `https://` scheme is added when missing |
| `page_type` | automatic | Force a specific extractor when auto-detection picks the wrong one: `article`, `product`, `discussion`, `image`, `video`, `list`, `event`, `job`, or `faq` |
| `format` | `markdown` | `markdown` for cleaned LLM-friendly content, `json` for the structured response matching the page type's ontology (title, text, author, date, images, links, tags, sentiment, ...) |

## Common fields in the JSON response

The `objects[0]` structure from the automatic/article extractor includes:

| Field | Description |
| --- | --- |
| `title` | Page/article title |
| `text` | Plain text of the main content |
| `content` | Markdown-formatted content |
| `pageUrl` | Canonical URL |
| `date` | Publication date (ISO 8601) |
| `author` | Author name |
| `tags` | Entity tags (from the Diffbot KG) |
| `images` | Extracted images |
| `links` | Outbound links |
| `type` | Detected page type (`article`, `product`, etc.) |

## Tips

- Re-check the index before extracting a batch of URLs: a `url:` lookup per URL costs ~300 ms and usually removes the need to extract most of them.
- If extraction fails, the page may be behind auth, a bot wall, or a JavaScript app. Try `page_type="article"` explicitly as a fallback.
- To pull the named entities out of an extracted page, pass its `text` field to `diffbot_resolve_entities` ($diffbot-entities).
- To find the pages of a whole site rather than one URL, use `diffbot_crawl` ($diffbot-crawl).
