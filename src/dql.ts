/** DQL execution, default column specs, and the cached ontology shared by every Knowledge Graph tool. */
import { DiffbotClient, dql as dqlRequest, Ontology, OntologyStore } from "@diffbot/typescript";

import { type CallContext, DiffbotToolError, isRecord } from "./api.js";

export type { Ontology };

const ONTOLOGY_TTL_MS = 86_400_000;
const PROBE_CONCURRENCY = 8;

// A full DQL entity record is ~75kb, so rows are pulled through the csv export with a
// column spec. These are the defaults per entity type, mirroring the specs the
// diffbot-skills use; the caller can override them with the fields parameter.
export const PLACE_FIELDS =
  "name,Place;population,Population;placeType,Type;location.region.name,Region;" +
  "location.country.name,Country;importance,Importance;id,Id";

export const DEFAULT_FIELDS: Record<string, string> = {
  Organization:
    "name,Company;descriptors,Description;nbEmployees,Employees;revenue.value,Revenue;" +
    "revenue.currency,Currency;location.city.name,City;location.country.name,Country;" +
    "homepageUri,Website;isPublic,Public;id,Id",
  Person:
    "name,Name;$.employments[0].title,Title;$.employments[0].employer.name,Employer;" +
    "location.city.name,City;location.country.name,Country;linkedInUri,LinkedIn;id,Id",
  Article:
    "date.str,Date;title,Title;siteName,Publisher;author,Author;sentiment,Sentiment;" +
    "pageUrl,URL;summary,Summary;id,Id",
  Product: "name,Name;brand,Brand;category,Category;offerPrice,Price;summary,Summary;id,Id",
  Investment:
    "investee.name,Company;investment.series,Round;investment.amount.value,Amount;" +
    "investment.amount.currency,Currency;investment.date.str,Date;" +
    "investment.investors.name,Lead Investor;id,Id",
  Transaction:
    "name,Name;payee.name,Payee;payers.name,Payer;amount.value,Amount;amount.currency,Currency;" +
    "date.str,Date;id,Id",
  "*": "id,Id;name,Name;description,Description",
};
for (const placeType of ["Place", "City", "Subregion", "Region", "Country", "AdministrativeArea"]) {
  DEFAULT_FIELDS[placeType] = PLACE_FIELDS;
}

const TYPE_PATTERN = /\btype:([A-Za-z]+)/;
// The csv export renders dates as d2026-07-23 and large numbers as 3.0E8.
const DATE_VALUE = /^d(\d{4}-\d{2}-\d{2}.*)$/;
const SCI_NOTATION = /^-?\d+(\.\d+)?E[+-]?\d+$/;

export function queryType(query: string): string | undefined {
  return TYPE_PATTERN.exec(query)?.[1];
}

export function defaultFields(query: string): string {
  return DEFAULT_FIELDS[queryType(query) ?? ""] ?? DEFAULT_FIELDS["*"];
}

export function cleanValue(value: string): string {
  const date = DATE_VALUE.exec(value);
  if (date) {
    return date[1];
  }
  if (SCI_NOTATION.test(value)) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? String(parsed) : String(parsed);
  }
  return value;
}

export function cleanRow(row: Record<string, string>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [column, value] of Object.entries(row)) {
    if (value) {
      cleaned[column] = cleanValue(value);
    }
  }
  return cleaned;
}

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, embedded newlines. Returns one object per row keyed by the header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) {
    return [];
  }
  return body
    .filter((cells) => cells.some((cell) => cell !== ""))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((column, index) => {
        record[column] = cells[index] ?? "";
      });
      return record;
    });
}

/** A DQL call that answers with JSON: counts, facet buckets, or entity records. */
async function dqlJson(ctx: CallContext, query: string, size: number, from = 0): Promise<unknown> {
  return dqlRequest(ctx, query, { size, from });
}

/** A DQL call through the csv export with a column spec. */
async function dqlCsv(ctx: CallContext, query: string, size: number, from: number, exportspec: string): Promise<string> {
  const raw = await dqlRequest(ctx, query, { size, from, format: "csv", exportspec, raw: true });
  return typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array);
}

function hitsOf(payload: unknown): number {
  return isRecord(payload) && typeof payload.hits === "number" ? payload.hits : 0;
}

export async function hits(ctx: CallContext, query: string): Promise<number> {
  return hitsOf(await dqlJson(ctx, query, 0));
}

export type ProbeResult = { query: string; hits: number | null; error?: string };

/** Hit counts for several queries in parallel; a failing query reports its error instead of failing the batch. */
export async function probe(ctx: CallContext, queries: string[]): Promise<ProbeResult[]> {
  const results: ProbeResult[] = new Array(queries.length);
  let next = 0;
  const worker = async () => {
    while (next < queries.length) {
      const index = next;
      next += 1;
      const query = queries[index];
      if (query.includes("similarTo(")) {
        results[index] = {
          query,
          hits: null,
          error:
            "similarTo cannot be probed: hits mirrors the requested size, so a size 0 probe always reports 0. Validate with a small export instead.",
        };
        continue;
      }
      try {
        results[index] = { query, hits: await hits(ctx, query) };
      } catch (error) {
        results[index] = { query, hits: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, queries.length) }, worker));
  return results;
}

export function isFacet(query: string): boolean {
  return query.includes("facet:") || query.includes("facet[");
}

export type RunOptions = {
  size?: number;
  offset?: number;
  fields?: string;
  format?: "csv" | "json";
  hitsOnly?: boolean;
  bareTypeCheck?: boolean;
};

export type FacetBucket = { value: unknown; count: unknown; query: unknown };

export type RunResult = {
  dql: string;
  hits: number | null;
  offset?: number;
  returned?: number;
  facet?: boolean;
  results?: unknown[];
  notes?: string[];
};

/** Execute a DQL query and shape the response: a count, facet buckets, csv rows, or json entities. */
export async function run(ctx: CallContext, query: string, options: RunOptions = {}): Promise<RunResult> {
  const size = options.size ?? 10;
  const offset = options.offset ?? 0;
  const format = options.format ?? "csv";

  if (options.hitsOnly || size < 1) {
    return { dql: query, hits: await hits(ctx, query) };
  }

  const notes: string[] = [];

  // facet queries answer with aggregate buckets rather than entities, and the csv
  // export is empty for them, so they are read from the json response instead
  if (isFacet(query)) {
    const result = await dqlJson(ctx, query, Math.max(size, 1));
    const data = isRecord(result) && Array.isArray(result.data) ? result.data : [];
    return {
      dql: query,
      hits: hitsOf(result),
      facet: true,
      results: data.slice(0, size).map((bucket: unknown): FacetBucket => {
        const record = isRecord(bucket) ? bucket : {};
        return { value: record.value, count: record.count, query: record.callbackQuery };
      }),
    };
  }

  // similarTo returns exactly `size` rows ranked by similarity and reports hits equal
  // to the size requested, so there is no meaningful total to fetch
  const similar = query.includes("similarTo(");
  if (similar) {
    notes.push(
      "similarTo returns a ranked list of exactly `size` rows; there is no total hit count. Ask for a larger size to go further down the ranking.",
    );
  }

  const entityType = queryType(query);
  const countTask = similar ? undefined : dqlJson(ctx, query, 0);
  // an unknown field path is silently ignored by the API and returns the unfiltered
  // type count, so the bare count is fetched alongside to make that visible. Article
  // is skipped: an unfiltered probe over the article index times out.
  const bareTask =
    options.bareTypeCheck && !similar && entityType && entityType !== "Article" && query.trim() !== `type:${entityType}`
      ? dqlJson(ctx, `type:${entityType}`, 0)
      : undefined;

  const dataTask =
    format === "json"
      ? dqlJson(ctx, query, size, offset)
      : dqlCsv(ctx, query, size, offset, options.fields ?? defaultFields(query));

  const [countResult, bareResult, dataResult] = await Promise.all([countTask, bareTask, dataTask]);

  const total = similar ? null : hitsOf(countResult);
  if (bareResult !== undefined && total !== null && total === hitsOf(bareResult)) {
    notes.push(
      "Hit count equals the unfiltered type count: a filter path was probably ignored. Confirm field names with diffbot_dql_ontology.",
    );
  }

  let results: unknown[];
  if (format === "json") {
    const data = isRecord(dataResult) && Array.isArray(dataResult.data) ? dataResult.data : [];
    results = data.map((record: unknown) => (isRecord(record) && record.entity !== undefined ? record.entity : record));
  } else {
    results = parseCsv(typeof dataResult === "string" ? dataResult : "").map(cleanRow);
  }

  const response: RunResult = { dql: query, hits: total, offset, returned: results.length, results };
  if (notes.length > 0) {
    response.notes = notes;
  }
  return response;
}

// --- ontology ---------------------------------------------------------------------

type OntologyCacheEntry = { store: OntologyStore; fetched: number };

// One store per token. The library's OntologyStore dedupes concurrent fetches and caches
// in memory; the timestamp adds the daily refresh the store leaves to its callers. The
// store gets its own client so a tool call's abort signal never cancels a shared fetch.
const ontologyStores = new Map<string, OntologyCacheEntry>();

/** The ~700kb ontology changes rarely, so it is fetched once per process per day. */
export async function getOntology(ctx: CallContext): Promise<Ontology> {
  let entry = ontologyStores.get(ctx.token);
  if (!entry) {
    entry = { store: new OntologyStore(new DiffbotClient({ token: ctx.token })), fetched: 0 };
    ontologyStores.set(ctx.token, entry);
  }
  const stale = Date.now() - entry.fetched > ONTOLOGY_TTL_MS;
  const ontology = await entry.store.load({ refresh: stale && entry.fetched > 0 });
  if (stale) {
    entry.fetched = Date.now();
  }
  return ontology;
}

/** Test hook: forget every cached ontology. */
export function resetOntologyCache(): void {
  ontologyStores.clear();
}

export type OntologyField = { field: string; type: string; flags?: string[]; description?: string };

export function formatField(name: string, meta: Record<string, unknown>): OntologyField {
  let fieldType = typeof meta.type === "string" ? meta.type : "?";
  if (fieldType === "LinkedEntity" && Array.isArray(meta.leType) && meta.leType.length > 0) {
    fieldType = `LinkedEntity (${String(meta.leType[0])})`;
  }
  const result: OntologyField = { field: name, type: fieldType };
  const flags = ["isList", "isComposite", "isEnum"].filter((flag) => Boolean(meta[flag]));
  if (flags.length > 0) {
    result.flags = flags;
  }
  if (typeof meta.description === "string" && meta.description) {
    result.description = meta.description;
  }
  return result;
}

export function ontologyNames(ontology: Ontology, kind: "types" | "composites" | "enums" | "taxonomies"): string[] {
  return ontology[kind]();
}

export function ontologyFields(ontology: Ontology, name: string, pattern?: RegExp): OntologyField[] {
  let fields: Record<string, Record<string, unknown>>;
  try {
    fields = ontology.fieldsFor(name);
  } catch {
    throw new DiffbotToolError(
      `'${name}' is not a known entity type or composite. Use action 'types' or 'composites' to list the valid names.`,
    );
  }
  return Object.entries(fields)
    .filter(([fieldName, meta]) => !meta.isDeprecated && (!pattern || pattern.test(fieldName)))
    .map(([fieldName, meta]) => formatField(fieldName, meta));
}

export function taxonomyValues(ontology: Ontology, name: string, pattern?: RegExp): string[] {
  let values: string[];
  try {
    values = ontology.taxonomyValues(name);
  } catch {
    throw new DiffbotToolError(`'${name}' is not a known taxonomy. Use action 'taxonomies' to list the valid names.`);
  }
  return pattern ? values.filter((value) => pattern.test(value)) : values;
}

export function enumValues(ontology: Ontology, name: string): string[] {
  try {
    return ontology.enumValues(name);
  } catch {
    throw new DiffbotToolError(`'${name}' is not a known enum. Use action 'enums' to list the valid names.`);
  }
}

export function findNamed(ontology: Ontology, pattern: RegExp): string[] {
  return ontology.findNamed(pattern.source);
}

/** Outcome of matching free text against a taxonomy or enum. */
export type Resolved = { value?: string; candidates: string[]; note?: string };

const MAX_CANDIDATES = 20;

/** Match text to one taxonomy or enum value: exact, then case-insensitive, then a unique substring hit. */
export async function resolveValue(
  ctx: CallContext,
  name: string,
  text: string,
  kind: "taxonomy" | "enum" = "taxonomy",
): Promise<Resolved> {
  const ontology = await getOntology(ctx);
  const values = kind === "taxonomy" ? taxonomyValues(ontology, name) : enumValues(ontology, name);
  if (values.includes(text)) {
    return { value: text, candidates: [] };
  }
  const lowered = text.trim().toLowerCase();
  const exact = values.filter((value) => value.toLowerCase() === lowered);
  if (exact.length === 1) {
    return { value: exact[0], candidates: [], note: `'${text}' resolved to the ${name} value '${exact[0]}'` };
  }
  const partial: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value.toLowerCase().includes(lowered) && !seen.has(value)) {
      seen.add(value);
      partial.push(value);
    }
  }
  if (partial.length === 1) {
    return { value: partial[0], candidates: [], note: `'${text}' resolved to the ${name} value '${partial[0]}'` };
  }
  if (partial.length > 0) {
    return {
      candidates: partial.slice(0, MAX_CANDIDATES),
      note: `'${text}' matches ${partial.length} ${name} values; pass one of the candidates exactly`,
    };
  }
  return {
    candidates: [],
    note: `'${text}' is not a ${name} value; look one up with diffbot_dql_ontology action 'taxonomy' name '${name}'`,
  };
}
