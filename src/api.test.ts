import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APIError, AuthError, ExtractionError, RateLimitError, ValidationError } from "@diffbot/typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient, DiffbotToolError, MISSING_TOKEN, normalizeUrl, readJson, readText, resolveToken, toToolError } from "./api.js";

const missingFile = join(tmpdir(), "diffbot-credentials-does-not-exist");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resolveToken", () => {
  it("prefers the plugin config over the environment", () => {
    expect(resolveToken({ apiToken: " cfg " }, { DIFFBOT_API_TOKEN: "env" }, missingFile)).toBe("cfg");
  });

  it("falls back to DIFFBOT_API_TOKEN then DIFFBOT_TOKEN", () => {
    expect(resolveToken({}, { DIFFBOT_API_TOKEN: "a", DIFFBOT_TOKEN: "b" }, missingFile)).toBe("a");
    expect(resolveToken(undefined, { DIFFBOT_TOKEN: "b" }, missingFile)).toBe("b");
  });

  it("reads the shared credentials file last", () => {
    vi.stubEnv("DIFFBOT_API_TOKEN", "");
    const file = join(tmpdir(), `diffbot-credentials-${process.pid}`);
    writeFileSync(file, "# comment\nDIFFBOT_API_TOKEN='from-file'\n");
    try {
      expect(resolveToken({}, {}, file)).toBe("from-file");
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("explains how to configure a token when none is found", () => {
    vi.stubEnv("DIFFBOT_API_TOKEN", "");
    expect(() => resolveToken({}, {}, missingFile)).toThrow(DiffbotToolError);
    expect(() => resolveToken({}, {}, missingFile)).toThrow(MISSING_TOKEN);
  });
});

describe("normalizeUrl", () => {
  it("adds https when the scheme is missing", () => {
    expect(normalizeUrl("example.com/page")).toBe("https://example.com/page");
    expect(normalizeUrl(" http://example.com ")).toBe("http://example.com");
  });
});

describe("createClient", () => {
  it("uses the stubbed global fetch and merges the tool call's abort signal", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        seen.push(init ?? {});
        return new Response("{}", { status: 200 });
      }),
    );
    const controller = new AbortController();
    const client = createClient({ apiToken: "t", timeoutSeconds: 5 }, controller.signal);
    await client.http.get("https://kg.diffbot.com/kg/v3/dql", { params: { query: "type:Organization" } });
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(seen[0].headers).get("user-agent")).toMatch(/^diffbot-typescript\//);
  });
});

describe("toToolError", () => {
  it("maps library errors to model-facing messages", () => {
    expect((toToolError(new AuthError(401, '{"message":"bad token"}')) as Error).message).toBe("Invalid or unauthorized Diffbot token: bad token");
    expect((toToolError(new RateLimitError(429, "", "7")) as Error).message).toBe("Diffbot rate limit exceeded, retry after 7s");
    expect((toToolError(new APIError(500, "boom")) as Error).message).toBe("Diffbot API error 500: boom");
    expect((toToolError(new ExtractionError(500, "Could not download page")) as Error).message).toMatch(
      /^Extraction error 500: Could not download page\. The page may be/,
    );
    expect((toToolError(new ValidationError("token is required")) as Error).message).toBe("token is required");
    const timeout = new Error("x");
    timeout.name = "TimeoutError";
    expect((toToolError(timeout) as Error).message).toMatch(/timed out/);
    expect((toToolError(new TypeError("fetch failed")) as Error).message).toBe("Diffbot request failed: fetch failed");
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(toToolError(abort)).toBe(abort);
    const own = new DiffbotToolError("mine");
    expect(toToolError(own)).toBe(own);
  });
});

describe("readJson and readText", () => {
  it("parse a successful body and raise the library errors on failure", async () => {
    await expect(readJson(new Response('{"ok":true}', { status: 200 }))).resolves.toEqual({ ok: true });
    await expect(readText(new Response("a,b\n1,2\n", { status: 200 }))).resolves.toBe("a,b\n1,2\n");
    await expect(readJson(new Response("", { status: 200 }))).resolves.toBeNull();
    await expect(readJson(new Response("not json", { status: 200 }))).rejects.toThrow(/non-JSON response/);
    await expect(readJson(new Response('{"message":"bad"}', { status: 401 }))).rejects.toBeInstanceOf(AuthError);
    await expect(readJson(new Response("", { status: 429, headers: { "retry-after": "7" } }))).rejects.toBeInstanceOf(RateLimitError);
    await expect(readText(new Response("boom", { status: 500 }))).rejects.toThrow("Diffbot API error 500: boom");
  });
});
