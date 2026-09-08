/** Pure helpers for assembling DQL strings. No I/O, so the typed tools' queries are unit-testable. */
import { DiffbotToolError } from "./api.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RADIUS_PATTERN = /^\d+(\.\d+)?\s?(mi|km)$/;

// Titles are free text and an abbreviation is not a substring of its expansion, so a
// C-suite search that omits either form silently under-counts by ~5x. Board seats are
// titled "Director" far more often than "Board Member" (904 vs 5 at Nvidia).
const TITLE_EXPANSIONS: Record<string, string[]> = {
  ceo: ["Chief Executive Officer", "CEO"],
  "chief executive officer": ["Chief Executive Officer", "CEO"],
  cto: ["Chief Technology Officer", "CTO"],
  "chief technology officer": ["Chief Technology Officer", "CTO"],
  cfo: ["Chief Financial Officer", "CFO"],
  "chief financial officer": ["Chief Financial Officer", "CFO"],
  coo: ["Chief Operating Officer", "COO"],
  "chief operating officer": ["Chief Operating Officer", "COO"],
  cio: ["Chief Information Officer", "CIO"],
  "chief information officer": ["Chief Information Officer", "CIO"],
  cmo: ["Chief Marketing Officer", "CMO"],
  "chief marketing officer": ["Chief Marketing Officer", "CMO"],
  "board member": ["Board Member", "Board of Directors", "Director"],
  "board of directors": ["Board Member", "Board of Directors", "Director"],
  board: ["Board Member", "Board of Directors", "Director"],
};

export function quote(value: string | number): string {
  const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function clause(field: string, value: string, strict = false): string {
  return `${strict ? "strict:" : ""}${field}:${quote(value)}`;
}

export function dedupe(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw).trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

export function orClause(field: string, values: Iterable<string>, strict = false): string {
  const unique = dedupe(values);
  if (unique.length === 0) {
    return "";
  }
  if (unique.length === 1) {
    return clause(field, unique[0], strict);
  }
  return `${strict ? "strict:" : ""}${field}:or(${unique.map(quote).join(",")})`;
}

/** field.{a b c}: co-constrain several conditions on the same nested list object. */
export function subquery(field: string, clauses: Iterable<string>): string {
  const inner = [...clauses].filter(Boolean).join(" ");
  return inner ? `${field}.{${inner}}` : "";
}

export function number(value: number): string {
  return Number.isInteger(value) ? String(Math.trunc(value)) : String(value);
}

export function compare(field: string, operator: string, value: string | number): string {
  if (typeof value === "number") {
    return `${field}${operator}${number(value)}`;
  }
  return `${field}${operator}${quote(String(value))}`;
}

export function validateDate(value: string | undefined | null, name: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!DATE_PATTERN.test(trimmed)) {
    throw new DiffbotToolError(`${name} must be a full date in YYYY-MM-DD form, got '${trimmed}'`);
  }
  return trimmed;
}

export function dateRange(field: string, since?: string | null, until?: string | null): string[] {
  const clauses: string[] = [];
  if (since) {
    clauses.push(compare(field, ">=", validateDate(since, "since") as string));
  }
  if (until) {
    clauses.push(compare(field, "<=", validateDate(until, "until") as string));
  }
  return clauses;
}

export function sortClause(field: string, descending = true): string {
  return `${descending ? "revSortBy" : "sortBy"}:${field}`;
}

export function nearClause(anchor: string, radius?: string | null): string {
  if (radius) {
    const compact = radius.trim().replace(/\s+/g, "");
    if (!RADIUS_PATTERN.test(compact)) {
      throw new DiffbotToolError(`radius must be a number followed by mi or km, e.g. '30mi', got '${radius}'`);
    }
    return `near(type:Place name:${quote(anchor)}, ${compact})`;
  }
  return `near(type:Place name:${quote(anchor)})`;
}

export function expandTitles(titles: Iterable<string>): string[] {
  const expanded: string[] = [];
  for (const title of titles) {
    expanded.push(...(TITLE_EXPANSIONS[title.trim().toLowerCase()] ?? [title]));
  }
  return dedupe(expanded);
}

/** The ASCII spelling of an accented name, or undefined when it is already ASCII. Diacritics are not normalized in the KG and coverage of each spelling is inconsistent. */
export function asciiVariant(text: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const folded = text.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  return folded && folded !== text ? folded : undefined;
}

export function nameVariants(text: string): string[] {
  const variant = asciiVariant(text);
  return variant ? [text, variant] : [text];
}

export function looksLikeDomain(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed.includes(" ") && trimmed.includes(".") && !trimmed.endsWith(".");
}

export function build(clauses: Iterable<string>): string {
  return [...clauses].filter(Boolean).join(" ");
}
