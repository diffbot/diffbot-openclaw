/**
 * The Diffbot client factory and error mapping shared by every tool.
 *
 * All HTTP goes through @diffbot/typescript, the official client library (a port of
 * diffbot-python). This module adds what a plugin needs on top of it: token resolution
 * that also honours the plugin config and the DIFFBOT_TOKEN alias, propagation of the
 * tool call's abort signal, and translation of library errors into messages the model
 * can act on.
 */
import {
  APIError,
  AuthError,
  DiffbotClient,
  DiffbotError,
  ExtractionError,
  RateLimitError,
  ValidationError,
} from "@diffbot/typescript";
import { authConfig, resolveToken as resolveTokenFromLibrary } from "@diffbot/typescript/node";

import { DEFAULT_TIMEOUT_SECONDS, type DiffbotConfig } from "./config.js";

export { DiffbotClient };

export const TOKEN_ENV_VARS = ["DIFFBOT_API_TOKEN", "DIFFBOT_TOKEN"] as const;
export const CREDENTIALS_KEY = "DIFFBOT_API_TOKEN";

export const MISSING_TOKEN =
  "No Diffbot token found. Set plugins.entries.diffbot.config.apiToken in openclaw.json, " +
  "set DIFFBOT_API_TOKEN or DIFFBOT_TOKEN in the environment, " +
  `or write '${CREDENTIALS_KEY}=<token>' to ~/.diffbot/credentials. ` +
  "Get a free token at https://app.diffbot.com/get-started";

/** A tool-level failure whose message is meant for the model. */
export class DiffbotToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiffbotToolError";
  }
}

/**
 * Plugin config first, then DIFFBOT_API_TOKEN or DIFFBOT_TOKEN, then the shared
 * ~/.diffbot/credentials file (read by the library's Node entry). `credentialsFile`
 * overrides the file location, for tests.
 */
export function resolveToken(
  config: DiffbotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  credentialsFile?: string,
): string {
  const fromEnv = env.DIFFBOT_API_TOKEN?.trim() || env.DIFFBOT_TOKEN?.trim() || undefined;
  const previous = authConfig.credentialsPath;
  if (credentialsFile) {
    authConfig.credentialsPath = credentialsFile;
  }
  let token: string;
  try {
    token = resolveTokenFromLibrary(config?.apiToken, { DIFFBOT_API_TOKEN: fromEnv });
  } finally {
    authConfig.credentialsPath = previous;
  }
  token = token.trim().replace(/^['"]|['"]$/g, "");
  if (!token) {
    throw new DiffbotToolError(MISSING_TOKEN);
  }
  return token;
}

export function timeoutMs(config: DiffbotConfig | undefined): number {
  const seconds = config?.timeoutSeconds;
  return (seconds && seconds > 0 ? seconds : DEFAULT_TIMEOUT_SECONDS) * 1000;
}

/**
 * A DiffbotClient for one tool call. The library applies its own per-request timeout;
 * the tool call's abort signal is merged in so a cancelled turn cancels the request.
 * `fetch` is looked up at call time so tests can stub the global.
 */
export function createClient(config: DiffbotConfig | undefined, signal?: AbortSignal): DiffbotClient {
  return new DiffbotClient({
    token: resolveToken(config),
    timeout: timeoutMs(config),
    fetch: (input, init) => {
      const merged = signal && init?.signal ? AbortSignal.any([signal, init.signal]) : (signal ?? init?.signal);
      return globalThis.fetch(input, { ...init, signal: merged });
    },
  });
}

/** Alias kept for the tool modules: the "call context" of a tool call is its client. */
export const callContext = createClient;
export type CallContext = DiffbotClient;

/** Translate a library or transport error into a DiffbotToolError; anything else passes through. */
export function toToolError(error: unknown): unknown {
  if (error instanceof DiffbotToolError) {
    return error;
  }
  if (error instanceof AuthError) {
    return new DiffbotToolError("Invalid or unauthorized Diffbot token" + (error.apiMessage ? `: ${error.apiMessage}` : ""));
  }
  if (error instanceof RateLimitError) {
    return new DiffbotToolError("Diffbot rate limit exceeded" + (error.retryAfter ? `, retry after ${error.retryAfter}s` : ""));
  }
  if (error instanceof ExtractionError) {
    return new DiffbotToolError(
      `Extraction error ${error.errorCode}: ${error.error}. The page may be behind a login, a bot wall, or a JavaScript app; try a specific page_type such as 'article'.`,
    );
  }
  if (error instanceof APIError || error instanceof ValidationError || error instanceof DiffbotError) {
    return new DiffbotToolError(error.message);
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError") {
      return new DiffbotToolError("Diffbot request timed out. Raise timeoutSeconds in the plugin config or narrow the request.");
    }
    if (error.name === "AbortError") {
      return error;
    }
    if (error instanceof TypeError || error.name === "FetchError") {
      return new DiffbotToolError(`Diffbot request failed: ${error.message}`);
    }
  }
  return error;
}

/** Run a tool body and map every Diffbot failure to a model-facing error. */
export async function withToolErrors<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    throw toToolError(error);
  }
}

/** Raise the library's error classes for a non-2xx response from a raw client.http call. */
export async function checkResponse(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  const body = await response.text().catch(() => "");
  if (response.status === 401 || response.status === 403) {
    throw new AuthError(response.status, body);
  }
  if (response.status === 429) {
    throw new RateLimitError(response.status, body, response.headers.get("retry-after"));
  }
  throw new APIError(response.status, body);
}

export async function readText(response: Response): Promise<string> {
  await checkResponse(response);
  return response.text();
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await readText(response);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DiffbotToolError(`Diffbot returned a non-JSON response: ${text.slice(0, 200)}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
