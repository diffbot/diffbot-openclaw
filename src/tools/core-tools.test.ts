import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolPluginExecutionContext } from "openclaw/plugin-sdk/tool-plugin";

import { crawlTool, jobSummary } from "./crawl.js";
import { dqlOntologyTool } from "./dql-ontology.js";
import { extractTool } from "./extract.js";
import { entityId, resolveEntitiesTool, shapeEntities } from "./resolve-entities.js";
import { searchWebTool } from "./search-web.js";

const config = { apiToken: "test-token" };
const context = { toolCallId: "call-1" } as unknown as ToolPluginExecutionContext;

type Execute<T> = (params: T, pluginConfig: typeof config, context: ToolPluginExecutionContext) => Promise<unknown> | unknown;

function stubFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("diffbot_extract", () => {
  it("calls analyze in llm mode by default and honors page_type and json format", async () => {
    const calls = stubFetch(() => new Response('{"objects":[]}', { status: 200 }));
    const execute = extractTool.execute as Execute<{ url: string; page_type?: "article"; format?: "json" }>;
    await execute({ url: "example.com" }, config, context);
    expect(calls[0].url.pathname).toBe("/v3/analyze");
    expect(calls[0].url.searchParams.get("mode")).toBe("llm");
    expect(calls[0].url.searchParams.get("url")).toBe("https://example.com");
    expect(calls[0].url.searchParams.get("token")).toBe("test-token");

    await execute({ url: "https://example.com", page_type: "article", format: "json" }, config, context);
    expect(calls[1].url.pathname).toBe("/v3/article");
    expect(calls[1].url.searchParams.has("mode")).toBe(false);
  });

  it("surfaces an extraction error reported inside a 200 body", async () => {
    stubFetch(() => new Response('{"errorCode":500,"error":"Could not download page"}', { status: 200 }));
    const execute = extractTool.execute as Execute<{ url: string }>;
    await expect(execute({ url: "https://example.com" }, config, context)).rejects.toThrow(/Extraction error 500: Could not download page/);
  });
});

describe("diffbot_search_web", () => {
  it("authenticates with a bearer header and forwards size and maxTokens", async () => {
    const calls = stubFetch(() => new Response('{"search_results":[]}', { status: 200 }));
    const execute = searchWebTool.execute as Execute<{ query: string; num_results?: number; max_tokens?: number }>;
    await execute({ query: "diffbot", num_results: 3, max_tokens: 2000 }, config, context);
    expect(calls[0].url.searchParams.get("text")).toBe("diffbot");
    expect(calls[0].url.searchParams.get("size")).toBe("3");
    expect(calls[0].url.searchParams.get("maxTokens")).toBe("2000");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer test-token");
  });
});

describe("diffbot_resolve_entities", () => {
  it("shapes the NLP response and builds the dql id filter", () => {
    expect(entityId({ id: "https://diffbot.com/entity/E123" })).toBe("E123");
    expect(entityId({ diffbotUri: "E456/" })).toBe("E456");
    expect(entityId({})).toBeNull();
    const shaped = shapeEntities({
      sentiment: 0.4,
      entities: [
        { name: "Apple", allTypes: [{ name: "organization" }], confidence: 0.99, salience: 0.8, sentiment: 0.1, id: "E1", mentions: [{}, {}] },
        { name: "Nobody", allTypes: [], confidence: 0.2, salience: 0.1, sentiment: 0, mentions: [] },
      ],
    });
    expect(shaped.entities.map((e) => e.id)).toEqual(["E1", null]);
    expect(shaped.entities[0].mentions).toBe(2);
    expect(shaped.dql_filter).toBe('id:or("E1")');
  });

  it("posts one plain-text document and unwraps the list response", async () => {
    const calls = stubFetch(() => new Response('[{"entities":[],"sentiment":0}]', { status: 200 }));
    const execute = resolveEntitiesTool.execute as Execute<{ text: string; lang?: string }>;
    const result = await execute({ text: "Hello", lang: "en" }, config, context);
    expect(calls[0].init?.method).toBe("POST");
    expect(new Headers(calls[0].init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual([{ lang: "en", format: "plain text", content: "Hello" }]);
    expect(calls[0].url.searchParams.get("fields")).toBe("entities,sentiment");
    expect(result).toEqual({ sentiment: 0, entities: [], dql_filter: null });
  });
});

describe("diffbot_crawl", () => {
  const execute = crawlTool.execute as Execute<Record<string, unknown>>;

  it("summarizes a job and reports running status codes", () => {
    expect(jobSummary({ name: "j", jobStatus: { status: 7, message: "Running" }, pageCrawlSuccesses: 3 })).toMatchObject({
      job_name: "j",
      status: "Running",
      status_code: 7,
      is_running: true,
      pages_crawled: 3,
    });
    expect(jobSummary({ name: "j", jobStatus: { status: 9, message: "Done" } }).is_running).toBe(false);
  });

  it("starts a job with the llm-mode api url and a generated name", async () => {
    const calls = stubFetch(() => new Response('{"response":"ok"}', { status: 200 }));
    const result = (await execute({ url: "docs.example.com", url_process_pattern: "/blog/" }, config, context)) as { job_name: string; created: boolean };
    expect(result.job_name).toMatch(/^crawl-\d+$/);
    expect(result.created).toBe(true);
    expect(calls).toHaveLength(1);
    const params = calls[0].url.searchParams;
    expect(params.get("seeds")).toBe("https://docs.example.com");
    expect(params.get("apiUrl")).toBe("https://api.diffbot.com/v3/analyze?mode=llm");
    expect(params.get("restrictDomain")).toBe("1");
    expect(params.has("obeyRobots")).toBe(false);
    expect(params.get("urlProcessPattern")).toBe("/blog/");
    expect(params.has("crawlDelay")).toBe(false);
  });

  it("requires a job name for job-scoped actions", async () => {
    await expect(execute({ action: "status" }, config, context)).rejects.toThrow(/job_name is required/);
    await expect(execute({ action: "start" }, config, context)).rejects.toThrow(/url is required/);
  });

  it("reports status, lists, and deletes through the library job calls", async () => {
    const calls = stubFetch((url) => {
      if (url.searchParams.get("delete") === "1") {
        return new Response('{"response":"Successfully deleted job."}', { status: 200 });
      }
      if (url.searchParams.get("name") === "missing") {
        return new Response('{"jobs":[]}', { status: 200 });
      }
      return new Response('{"jobs":[{"name":"j","jobStatus":{"status":0,"message":"Running"},"pageCrawlSuccesses":1}]}', { status: 200 });
    });
    expect(await execute({ action: "status", job_name: "j" }, config, context)).toMatchObject({ job_name: "j", is_running: true });
    await expect(execute({ action: "status", job_name: "missing" }, config, context)).rejects.toThrow(/No crawl job named 'missing'/);
    expect(await execute({ action: "list" }, config, context)).toEqual({
      jobs: [expect.objectContaining({ job_name: "j", status: "Running", pages_crawled: 1 })],
    });
    expect(await execute({ action: "delete", job_name: "j" }, config, context)).toEqual({ job_name: "j", deleted: true });
    expect(calls.map((c) => c.url.searchParams.get("token"))).toEqual(["test-token", "test-token", "test-token", "test-token"]);
  });

  it("maps an auth failure to a readable tool error", async () => {
    stubFetch(() => new Response('{"message":"bad token"}', { status: 401 }));
    await expect(execute({ action: "list" }, config, context)).rejects.toThrow("Invalid or unauthorized Diffbot token: bad token");
  });

  it("pages through urls parsed from the csv export", async () => {
    stubFetch(() => new Response('Url,Crawl Status,Crawled Time\n"https://a",Success,2026-01-01\n"https://b",Error,\n', { status: 200 }));
    const result = await execute({ action: "urls", job_name: "j", max_results: 1, offset: 1 }, config, context);
    expect(result).toEqual({
      job_name: "j",
      total_urls: 2,
      offset: 1,
      urls: [{ url: "https://b", status: "Error", crawled: null }],
    });
  });

  it("reads results and surfaces a job-level error", async () => {
    stubFetch(() => new Response('{"objects":[{"title":"A"},{"title":"B"}]}', { status: 200 }));
    expect(await execute({ action: "results", job_name: "j", max_results: 1 }, config, context)).toEqual({
      job_name: "j",
      total_results: 2,
      offset: 0,
      results: [{ title: "A" }],
    });
    stubFetch(() => new Response('{"error":"Job not found"}', { status: 200 }));
    await expect(execute({ action: "results", job_name: "j" }, config, context)).rejects.toThrow(/Job not found \(job 'j'\)/);
  });
});

describe("diffbot_dql_ontology", () => {
  it("validates required arguments before touching the network", async () => {
    const execute = dqlOntologyTool.execute as Execute<{ action: string; name?: string; search?: string }>;
    await expect(execute({ action: "fields" }, config, context)).rejects.toThrow(/name is required/);
    await expect(execute({ action: "search" }, config, context)).rejects.toThrow(/search is required/);
    await expect(execute({ action: "search", search: "(" }, config, context)).rejects.toThrow(/not a valid regular expression/);
  });
});
