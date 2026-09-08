---
name: diffbot-crawl
description: "Crawl a website or manage Diffbot crawler jobs. Use when the user wants to crawl a site for structured content, list existing crawl jobs, or delete a crawl job. Triggers on: crawl website, crawl site, crawler job, list crawl jobs, delete crawl job, diffbot crawl."
homepage: https://github.com/diffbot/diffbot-openclaw
metadata: {"openclaw": {"emoji": "🕷️", "homepage": "https://github.com/diffbot/diffbot-openclaw"}}
---

# Diffbot Crawler

Crawl websites for structured content with the `diffbot_crawl` tool, and manage crawler jobs. A crawl finds every link from a seed URL and extracts each page it visits, the same way `diffbot_extract` handles one URL. Use it when a task needs many pages of a site rather than one known URL.

The plugin needs a Diffbot token: set `plugins.entries.diffbot.config.apiToken` in openclaw.json, or `DIFFBOT_API_TOKEN` in the environment, or a `DIFFBOT_API_TOKEN=...` line in `~/.diffbot/credentials`. Free tokens at https://app.diffbot.com/get-started. There is nothing to install; the plugin calls Diffbot over HTTP.

Crawls run as **background jobs**. The tool does not block until the crawl finishes; you start a job, poll its status, then read the results.

```
diffbot_crawl(action="start", url="<SITE>", ...options)      # create a job; returns job_name
diffbot_crawl(action="status", job_name="<NAME>")            # progress; is_running tells you whether to keep polling
diffbot_crawl(action="urls", job_name="<NAME>")              # every URL visited with its per-page crawl status
diffbot_crawl(action="results", job_name="<NAME>")           # the extracted pages
diffbot_crawl(action="list")                                 # every job on the token
diffbot_crawl(action="delete", job_name="<NAME>")            # remove a job
```

`action` defaults to `start`. `start` requires `url`; `status`, `urls`, `results`, and `delete` require `job_name`. The job name is the only handle on a job, so keep the name returned by `start`.

## `start` options

| Parameter | Default | Description |
| --- | --- | --- |
| `hops` | 2 | Maximum link depth from the seed URL |
| `job_name` | generated | Name for the job. It is the only handle on the job, so keep it |
| `max_to_crawl` | 100 | Maximum pages to crawl |
| `max_to_process` | 100 | Maximum crawled pages to extract content from |
| `restrict_domain` | true | Only follow links on the same domain as the seed |
| `url_crawl_pattern` | none | Only crawl URLs containing this pattern |
| `url_process_pattern` | none | Only extract content from URLs containing this pattern, e.g. `/blog/`. Narrows extraction without narrowing crawling |
| `obey_robots` | false | Obey robots.txt |
| `use_proxies` | false | Use proxies for crawling |
| `crawl_delay` | none | Seconds between requests to the same domain |
| `custom_headers` | none | Newline-separated custom HTTP headers, e.g. `Cookie: a=b\nUser-Agent: x` |
| `page_type` | automatic | Extract every page as this type (`article`, `product`, `discussion`, `image`, `video`, `list`, `event`, `job`, `faq`) |
| `format` | `markdown` | How each page is stored: LLM-friendly markdown or structured JSON |

## `urls` and `results` options

| Parameter | Default | Description |
| --- | --- | --- |
| `max_results` | 10 | Maximum rows to return |
| `offset` | 0 | Rows to skip, for paging through a large crawl |

## Reading `status`

`status` returns `job_name`, `status` (the message), `status_code`, `is_running`, `pages_crawled`, `pages_processed`, `objects_found`, and `created`. `is_running` is derived from the job's status code: **codes 0 and 7 mean the crawl is still in progress**; any other code means the job has stopped (finished, paused, or failed; read the `status` message) and the results can be read. `list` returns the same summary for every job on the token.

## Workflow

1. **Start.** `diffbot_crawl(action="start", url="https://docs.example.com", hops=3, max_to_crawl=500, max_to_process=500)`. Note the returned `job_name`.
2. **Poll.** `diffbot_crawl(action="status", job_name=...)` until `is_running` is false. Small sites finish in a minute or two; do not poll more often than every 15-30 seconds.
3. **Inspect.** `diffbot_crawl(action="urls", job_name=...)` lists each URL with `Success` or an error status (`url`, `status`, `crawled` time per row, with `total_urls`), so failed pages are visible before reading the payload.
4. **Read.** `diffbot_crawl(action="results", job_name=..., max_results=10, offset=0)` pages through the extracted objects (`total_results` reports how many there are). Each carries the same fields `diffbot_extract` returns (`title`, `pageUrl`, `content` or `text`, ...). Read a few pages at a time rather than pulling a whole crawl into the conversation.

Crawl only blog posts by URL pattern:

```
diffbot_crawl(action="start", url="https://example.com", url_process_pattern="/blog/", max_to_process=200)
```

## Tips

- `restrict_domain` is on by default; disable it only if you intentionally want to follow external links.
- Use `url_process_pattern` to focus extraction on specific path segments without narrowing crawling.
- Set `job_name` yourself if you want to look the job up or delete it later; generated names are `crawl-<timestamp>`.
- For a single known page, `diffbot_extract` ($diffbot-extract) is faster; for pages Diffbot has already indexed, `diffbot_search_web` with a `url:` prefix ($diffbot-web-search) is faster still.
