import { crawl, crawlDeleteJob, crawlGetJob, crawlListJobs } from "@diffbot/typescript";
import { Type } from "typebox";

import { callContext, DiffbotToolError, isRecord, normalizeUrl, readJson, readText } from "../api.js";
import { parseCsv } from "../dql.js";
import { defineTool, PAGE_TYPES } from "./shared.js";

// jobStatus.status codes 0 and 7 mean the job is still in progress
const RUNNING_STATUS_CODES = new Set([0, 7]);

const DESCRIPTION =
  "Crawls a website and extracts every page it visits into structured data. Use when a task needs many pages of " +
  "a site rather than one known URL, which diffbot_extract already handles. Crawls run as background jobs and are not " +
  "instant: 'start' creates a job and returns its name, 'status' reports progress, 'urls' lists every URL the " +
  "crawler has visited with its per-page crawl status, 'results' returns the extracted pages, 'list' shows every " +
  "job on the token, and 'delete' removes a job. Poll status until is_running is false before reading results. " +
  "The job name is the only handle on a job, so keep the name returned by 'start'.";

const ACTIONS = ["start", "status", "urls", "results", "list", "delete"] as const;

export function jobSummary(job: Record<string, unknown>): Record<string, unknown> {
  const status = isRecord(job.jobStatus) ? job.jobStatus : {};
  const code = typeof status.status === "number" ? status.status : undefined;
  return {
    job_name: job.name,
    status: status.message,
    status_code: code,
    is_running: code !== undefined && RUNNING_STATUS_CODES.has(code),
    pages_crawled: job.pageCrawlSuccesses,
    pages_processed: job.pageProcessSuccesses,
    objects_found: job.objectsFound,
    created: job.jobCreationTimeUTC,
  };
}

export const crawlTool = defineTool({
  name: "diffbot_crawl",
  label: "Diffbot Crawl",
  description: DESCRIPTION,
  parameters: Type.Object({
    action: Type.Optional(
      Type.Union(
        ACTIONS.map((value) => Type.Literal(value)),
        {
          description:
            "The operation to perform. 'start' requires url. 'status', 'urls', 'results' and 'delete' require job_name. Defaults to start.",
          default: "start",
        },
      ),
    ),
    url: Type.Optional(Type.String({ description: "The seed URL to crawl from. Required for 'start', ignored otherwise." })),
    job_name: Type.Optional(
      Type.String({
        description:
          "The name of the crawl job. Required for 'status', 'urls', 'results' and 'delete'. Optional for 'start', where one is generated if omitted.",
      }),
    ),
    hops: Type.Optional(
      Type.Integer({ description: "Maximum link depth to follow from the seed URL. Only applies to 'start'. Defaults to 2.", minimum: 0, default: 2 }),
    ),
    max_to_crawl: Type.Optional(
      Type.Integer({ description: "Maximum number of pages to crawl. Only applies to 'start'. Defaults to 100.", minimum: 1, default: 100 }),
    ),
    max_to_process: Type.Optional(
      Type.Integer({
        description: "Maximum number of crawled pages to extract content from. Only applies to 'start'. Defaults to 100.",
        minimum: 1,
        default: 100,
      }),
    ),
    restrict_domain: Type.Optional(
      Type.Boolean({ description: "Only follow links on the same domain as the seed URL. Only applies to 'start'. Defaults to true.", default: true }),
    ),
    url_crawl_pattern: Type.Optional(
      Type.String({ description: "Optional. Only crawl URLs containing this pattern. Only applies to 'start'." }),
    ),
    url_process_pattern: Type.Optional(
      Type.String({
        description:
          "Optional. Only extract content from URLs containing this pattern, e.g. '/blog/'. Narrows extraction without narrowing crawling. Only applies to 'start'.",
      }),
    ),
    obey_robots: Type.Optional(Type.Boolean({ description: "Obey the site's robots.txt. Only applies to 'start'. Defaults to false.", default: false })),
    use_proxies: Type.Optional(Type.Boolean({ description: "Use proxies to crawl the site. Only applies to 'start'. Defaults to false.", default: false })),
    crawl_delay: Type.Optional(
      Type.Number({ description: "Optional. Seconds to wait between requests to the same domain. Only applies to 'start'." }),
    ),
    custom_headers: Type.Optional(
      Type.String({
        description:
          "Optional. Custom HTTP headers to send with every request, newline separated, e.g. 'Cookie: a=b\\nUser-Agent: x'. Only applies to 'start'.",
      }),
    ),
    page_type: Type.Optional(
      Type.Union(
        PAGE_TYPES.map((value) => Type.Literal(value)),
        {
          description:
            "Optional. The page type to extract every crawled page as. Defaults to automatic classification. Only applies to 'start'.",
        },
      ),
    ),
    format: Type.Optional(
      Type.Union([Type.Literal("markdown"), Type.Literal("json")], {
        description:
          "The format each crawled page is stored in: 'markdown' for LLM friendly markdown, 'json' for the structured response matching the page type's ontology. Only applies to 'start'. Defaults to markdown.",
        default: "markdown",
      }),
    ),
    max_results: Type.Optional(
      Type.Integer({ description: "Maximum number of rows to return. Applies to 'urls' and 'results'. Defaults to 10.", minimum: 1, default: 10 }),
    ),
    offset: Type.Optional(
      Type.Integer({ description: "Number of rows to skip, for paging through a large crawl. Applies to 'urls' and 'results'.", minimum: 0, default: 0 }),
    ),
  }),
  async execute(params, config, context) {
    const client = callContext(config, context.signal);
    const action = params.action ?? "start";
    const maxResults = params.max_results ?? 10;
    const offset = params.offset ?? 0;

    if (action !== "start" && action !== "list" && !params.job_name) {
      throw new DiffbotToolError(`job_name is required for action '${action}'`);
    }
    const jobName = params.job_name;

    if (action === "start") {
      if (!params.url) {
        throw new DiffbotToolError("url is required to start a crawl");
      }
      const name = jobName || `crawl-${Math.floor(Date.now() / 1000)}`;
      let apiUrl = `${client.analyzeUrl}/${params.page_type ?? "analyze"}`;
      if ((params.format ?? "markdown") === "markdown") {
        apiUrl = `${apiUrl}?mode=llm`;
      }
      // the library's crawl() is a generator that yields job_created first; without
      // watch it stops there, so one step creates the job
      const events = crawl(client, normalizeUrl(params.url), {
        jobName: name,
        apiUrl,
        hops: params.hops ?? 2,
        maxToCrawl: params.max_to_crawl ?? 100,
        maxToProcess: params.max_to_process ?? 100,
        restrictDomain: params.restrict_domain ?? true,
        obeyRobots: params.obey_robots ?? false,
        useProxies: params.use_proxies ?? false,
        urlCrawlPattern: params.url_crawl_pattern,
        urlProcessPattern: params.url_process_pattern,
        customHeaders: params.custom_headers,
        crawlDelay: params.crawl_delay && params.crawl_delay > 0 ? params.crawl_delay : undefined,
      });
      const first = await events.next();
      await events.return(undefined);
      const details = first.done ? {} : first.value.details;
      return { job_name: String(details.job_name ?? name), created: true };
    }

    if (action === "status") {
      const job = await crawlGetJob(client, jobName as string);
      if (Object.keys(job).length === 0) {
        throw new DiffbotToolError(`No crawl job named '${jobName}'`);
      }
      return jobSummary(job);
    }

    if (action === "list") {
      return { jobs: (await crawlListJobs(client)).map(jobSummary) };
    }

    if (action === "delete") {
      await crawlDeleteJob(client, jobName as string);
      return { job_name: jobName, deleted: true };
    }

    // the /data endpoint (visited urls and extracted objects) is not wrapped by the
    // library, so it goes through the client's HTTP layer directly
    const data = (query: Record<string, string | number>) =>
      client.http.get(`${client.crawlerUrl}/data`, {
        params: { token: client.token, name: jobName as string, ...query },
        redirect: "follow",
      });

    if (action === "urls") {
      const text = await readText(await data({ type: "urls" }));
      const rows = parseCsv(text)
        .map((row) => ({
          url: (row.Url ?? "").trim().replace(/^"|"$/g, ""),
          status: (row["Crawl Status"] ?? "unknown").trim() || "unknown",
          crawled: (row["Crawled Time"] ?? "").trim() || null,
        }))
        .filter((row) => row.url);
      return { job_name: jobName, total_urls: rows.length, offset, urls: rows.slice(offset, offset + maxResults) };
    }

    const response = await readJson(await data({ format: "json" }));
    let objects: unknown[];
    if (isRecord(response)) {
      if (response.error) {
        throw new DiffbotToolError(`${String(response.error)} (job '${jobName}')`);
      }
      objects = Array.isArray(response.objects) ? response.objects : [];
    } else {
      objects = Array.isArray(response) ? response : [];
    }
    return { job_name: jobName, total_results: objects.length, offset, results: objects.slice(offset, offset + maxResults) };
  },
});
