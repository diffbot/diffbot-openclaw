# Diffbot for OpenClaw

Structured web knowledge for [OpenClaw](https://openclaw.ai) agents. This plugin gives an agent Diffbot's Knowledge Graph and web-structuring APIs as native tools, plus ten bundled skills that teach it how to use them well.

It is the OpenClaw counterpart of [diffbot-skills](https://github.com/diffbot/diffbot-skills) (agent skills for Claude Code, Copilot, Cortex, Factory) and [diffbot-mcp](https://github.com/diffbot/diffbot-mcp) (the MCP server): the same capabilities, the same tool contracts, running in-process in the OpenClaw Gateway with nothing to install on the client. All Diffbot API calls go through [`@diffbot/typescript`](https://github.com/diffbot/diffbot-typescript), the official client library.

## Install

From ClawHub (once published):

```bash
openclaw plugins install clawhub:@diffbot/openclaw-plugin
```

From a local checkout:

```bash
git clone https://github.com/diffbot/diffbot-openclaw.git
cd diffbot-openclaw
npm install
npm run plugin:build
openclaw plugins install . --accept-capabilities
```

Recent OpenClaw releases ask for explicit capability consent on install; the flag records it. Then restart the Gateway. Confirm the plugin and its tools loaded with:

```bash
openclaw plugins inspect diffbot --runtime
```

## Setup

A Diffbot token is required. Get a free one at [app.diffbot.com/get-started](https://app.diffbot.com/get-started). The plugin resolves the token in this order:

1. `plugins.entries.diffbot.config.apiToken` in `openclaw.json`
2. The `DIFFBOT_API_TOKEN` or `DIFFBOT_TOKEN` environment variable
3. A `DIFFBOT_API_TOKEN=<token>` line in `~/.diffbot/credentials`, the same file the [`db` CLI](https://github.com/diffbot/diffbot-python), diffbot-skills, diffbot-mcp, and `@diffbot/typescript` read, so one credential serves all of them

Config example:

```json5
{
  plugins: {
    entries: {
      diffbot: {
        enabled: true,
        config: {
          apiToken: "YOUR_TOKEN",
          timeoutSeconds: 120, // optional, per-request timeout
        },
      },
    },
  },
}
```

## Tools

All twelve tools are required tools: they are available as soon as the plugin is enabled. Every tool name is prefixed `diffbot_` so nothing collides with OpenClaw's core `web_search` and `web_fetch`.

### Web

| Tool | What it does |
| --- | --- |
| `diffbot_search_web` | Web search that ranks accuracy over popularity, built on Diffbot's first-party index. Returns scored, dated results with the matching content chunks. Query `url:<URL> <what you need>` reads Diffbot's already-parsed copy of a known page in about 300ms, even for pages that block fetchers. |
| `diffbot_extract` | Live fetch of a URL into LLM-friendly markdown or structured JSON, with automatic page classification (article, product, discussion, ...). The replacement for a raw web fetch. |
| `diffbot_crawl` | Crawl a site and extract every page as a background job: `start`, `status`, `urls`, `results`, `list`, `delete`. |
| `diffbot_resolve_entities` | Named entity recognition and resolution to Knowledge Graph ids, with confidence, salience, and sentiment. Returns a ready-made `dql_filter`. |

### Knowledge Graph

| Tool | What it does |
| --- | --- |
| `diffbot_search_news` | Articles by mentioned entity, topic, publisher, language, date range, or sentiment. Newest first. Use it for all news, including breaking stories. |
| `diffbot_search_organizations` | Companies by industry, headquarters, headcount, revenue, funding, ownership, or leadership, plus `similar_to` lookalike lists. |
| `diffbot_search_people` | People by title, employer, employer industry, skills, education, location, or nationality. Employment conditions are co-constrained on one job; C-suite titles are expanded to both spellings. |
| `diffbot_search_places` | Cities, counties, states, countries, and points of interest by name, population, prominence, containing place, or proximity. |
| `diffbot_search_deals` | Funding rounds, investments, and acquisitions by date, size, series, investor, acquirer, or industry. |
| `diffbot_dql` | Raw DQL over any entity type: products, patents, brands, job posts, facet aggregations, cross-entity queries. Compact CSV rows by default, full JSON on request. |
| `diffbot_dql_probe` | Parallel hit counts for several candidate queries, to check selectivity before pulling rows. |
| `diffbot_dql_ontology` | Entity types, fields, taxonomies, and enums, so field paths and taxonomy values are confirmed instead of guessed. |

Each typed Knowledge Graph tool resolves free-text industry and topic values against the live ontology, returns the DQL it ran, and reports candidates when a value is ambiguous.

## Skills

Ten skills ship in `skills/` and load automatically with the plugin. They carry the long-form workflow guidance from diffbot-skills: the operator reference, the measured traps, and the display rules. Reference them in a prompt with `$diffbot-news`, `$diffbot-dql`, and so on, or invoke them as slash commands.

| Skill | Covers |
| --- | --- |
| `diffbot-news` | The sort rule, narrowing levers, entity-specific sentiment, coverage facets |
| `diffbot-organizations` | Industry taxonomy, HQ vs offices, strict name matching, `near`, `similarTo` |
| `diffbot-people` | The `{}` co-constraint rule, employer-industry filtering, title traps, coverage boundary |
| `diffbot-places` | The place-type hierarchy, containment, the continent gap, diacritics |
| `diffbot-deals` | Investment vs Organization vs Transaction routing, the investee industry gap, amounts |
| `diffbot-dql` | Full DQL operator reference, ontology lookup, probing, csv vs json fetches |
| `diffbot-web-search` | The index-before-fetch rule and when a cached copy cannot be trusted |
| `diffbot-extract` | When a live fetch is actually needed, page types, response fields |
| `diffbot-entities` | Confidence vs salience, bridging text to DQL with entity ids |
| `diffbot-crawl` | Start, poll, inspect, read |

## Development

Requires Node 24.16+ (or 26.1+) and npm.

```bash
npm install
npm run typecheck        # tsc --noEmit
npm test                 # vitest: builder, executor, and tool unit tests (no network)
npm run plugin:build     # compile to dist/ and regenerate openclaw.plugin.json
npm run plugin:validate  # check the manifest, entry, and package metadata
npm run check            # all of the above
```

Layout:

```
src/
  index.ts          plugin entry (defineToolPlugin) registering the twelve tools
  config.ts         TypeBox config schema (apiToken, timeoutSeconds)
  api.ts            DiffbotClient factory (from @diffbot/typescript), token resolution, error mapping
  dql.ts            DQL executor, csv export, OntologyStore cache and lookups
  dql-builder.ts    pure DQL string helpers
  tools/            one module per tool
skills/             ten SKILL.md files loaded via the manifest's "skills" field
assets/icon.png     catalog icon (rendered from diffbot.com's favicon.svg)
openclaw.plugin.json
```

`openclaw plugins build` regenerates the `id`, `description`, `configSchema`, `activation`, and `contracts.tools` fields of the manifest from the entry; the hand-maintained `skills` field is preserved. Run it after adding or renaming a tool, or validation fails with a stale-manifest error.

Packaged smoke test:

```bash
npm pack
openclaw plugins install npm-pack:./diffbot-openclaw-plugin-0.1.0.tgz --force --accept-capabilities
openclaw plugins inspect diffbot --runtime --json
```

## Publishing to ClawHub

```bash
npm i -g clawhub
clawhub login
clawhub package validate .
clawhub package publish . --dry-run --source-repo diffbot/diffbot-openclaw --source-commit <sha> --topics "Web Search,Web Extraction,Knowledge Graph,Crawling,Entity Resolution" --categories web
clawhub package publish . --source-repo diffbot/diffbot-openclaw --source-commit <sha> --topics "Web Search,Web Extraction,Knowledge Graph,Crawling,Entity Resolution" --categories web
```

`--topics` and `--categories` are publish-time-only metadata: ClawHub does not derive them from npm `keywords` or the plugin manifest, and there is no way to set them after publishing. They drive `openclaw plugins search` ranking (a `Web Search` topic lifts the score above the top-20 display cutoff for queries like `openclaw plugins search "web search"`).

The package name is scoped to the ClawHub owner (`@diffbot/openclaw-plugin`), as ClawHub requires. New releases stay hidden from install surfaces until ClawHub's automated security checks and review finish. After the first manual publish, `clawhub package trusted-publisher set @diffbot/openclaw-plugin --repository diffbot/diffbot-openclaw --workflow-filename clawhub-publish.yml` lets the `.github/workflows/clawhub-publish.yml` workflow publish from GitHub Actions without a stored token.

## License

MIT. See [LICENSE](LICENSE).
