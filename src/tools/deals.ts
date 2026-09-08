import { Type } from "typebox";

import { callContext, DiffbotToolError, isRecord } from "../api.js";
import { build, clause, compare, dateRange, sortClause, subquery } from "../dql-builder.js";
import { cleanValue, DEFAULT_FIELDS, resolveValue, run } from "../dql.js";
import { defineTool } from "./shared.js";

const DESCRIPTION =
  "Searches funding rounds, investments, and acquisitions in the Diffbot Knowledge Graph by date, deal size, " +
  "round series, investor, acquirer, or industry, and returns deals as rows: target, counterparty, amount, " +
  "currency, date. USE THIS when the answer is a list of deals: deal flow, the funding history of a company, an " +
  "investor's recent activity, the largest acquisitions of a year. Rows are deals, not companies. kind routes " +
  "the query: 'funding' reads Investment records, 'acquisitions' reads the acquiredBy field on the acquired " +
  "company because standalone Acquisition records are empty stubs, 'any' reads every Transaction. An industry " +
  "filter is applied on the company side, since a deal's investee carries no categories. Amounts are raw numbers " +
  "with a currency; a blank amount means undisclosed and 'Series Unknown' is a real value. Set facet for " +
  "distribution questions (most active investors, funding by stage). Returns the DQL it ran.";

export type DealKind = "funding" | "acquisitions" | "any";
export type DealsSort = "newest" | "largest";
export type DealsFacet = "series" | "investors" | "amount";

export const ACQUISITION_FIELDS =
  "name,Target;acquiredBy.name,Acquirer;acquiredBy.amount.value,Amount;acquiredBy.amount.currency,Currency;" +
  "acquiredBy.date.str,Date;categories.name,Industry;id,Id";
export const INDUSTRY_GET = "get:id,name,investments,categories";

export type DealsQueryOptions = {
  kind?: DealKind;
  company?: string;
  investor?: string;
  acquirer?: string;
  series?: string;
  min_amount?: number;
  max_amount?: number;
  currency?: string;
  since?: string;
  until?: string;
  industry?: string;
  sort?: DealsSort;
  facet?: DealsFacet;
};

export type DealsQuery = { dql: string; fields?: string; mode: "rows" | "industry" };

/** Return {dql, fields, mode} where mode is 'rows' or 'industry' (company-side json read). industry must already be an exact OrganizationCategory value. */
export function buildDealsQuery(options: DealsQueryOptions = {}): DealsQuery {
  const {
    kind = "funding",
    company,
    investor,
    acquirer,
    series,
    min_amount,
    max_amount,
    currency = "USD",
    since,
    until,
    industry,
    sort,
    facet,
  } = options;
  const hasAmount = min_amount !== undefined || max_amount !== undefined;

  if (kind === "acquisitions") {
    const clauses = ["type:Organization", "isAcquired:true"];
    if (company) {
      clauses.push(clause("name", company, true));
    }
    if (acquirer) {
      clauses.push(clause("acquiredBy.name", acquirer));
    }
    if (investor) {
      throw new DiffbotToolError("investor does not apply to acquisitions; use acquirer.");
    }
    if (series) {
      throw new DiffbotToolError("series does not apply to acquisitions.");
    }
    if (industry) {
      clauses.push(clause("categories.name", industry));
    }
    if (min_amount !== undefined) {
      clauses.push(compare("acquiredBy.amount.value", ">=", min_amount));
    }
    if (max_amount !== undefined) {
      clauses.push(compare("acquiredBy.amount.value", "<=", max_amount));
    }
    if (hasAmount && currency) {
      clauses.push(clause("acquiredBy.amount.currency", currency));
    }
    clauses.push(...dateRange("acquiredBy.date", since, until));
    if (facet) {
      const facetField = { investors: "acquiredBy.name", amount: "acquiredBy.amount.value" }[facet as string];
      if (!facetField) {
        throw new DiffbotToolError("facet 'series' does not apply to acquisitions.");
      }
      clauses.push(`facet:${facetField}`);
    } else if (sort) {
      clauses.push(sortClause(sort === "newest" ? "acquiredBy.date" : "acquiredBy.amount.value"));
    }
    return { dql: build(clauses), fields: ACQUISITION_FIELDS, mode: "rows" };
  }

  if (kind === "funding" && industry) {
    // investee is a bare LinkedEntity with no categories, so the industry lives on the
    // company; the round's conditions are co-constrained on one investment with {}
    const roundConditions: string[] = [];
    if (series) {
      roundConditions.push(clause("series", series));
    }
    if (investor) {
      roundConditions.push(clause("investors.name", investor));
    }
    if (min_amount !== undefined) {
      roundConditions.push(compare("amount.value", ">=", min_amount));
    }
    if (max_amount !== undefined) {
      roundConditions.push(compare("amount.value", "<=", max_amount));
    }
    if (hasAmount && currency) {
      roundConditions.push(clause("amount.currency", currency));
    }
    roundConditions.push(...dateRange("date", since, until));
    const clauses = ["type:Organization", clause("categories.name", industry)];
    if (company) {
      clauses.push(clause("name", company, true));
    }
    clauses.push(roundConditions.length > 0 ? subquery("investments", roundConditions) : "has:investments");
    if (facet) {
      throw new DiffbotToolError("facet does not combine with industry; drop industry or facet.");
    }
    if (sort) {
      clauses.push(sortClause(sort === "newest" ? "investments.date" : "investments.amount.value"));
    }
    return { dql: build(clauses), fields: undefined, mode: "industry" };
  }

  let clauses: string[];
  let companyField: string;
  let investorField: string;
  let amountField: string;
  let dateField: string;
  if (kind === "funding") {
    clauses = ["type:Investment"];
    [companyField, investorField, amountField, dateField] = ["investee.name", "investment.investors.name", "investment.amount", "investment.date"];
  } else {
    clauses = ["type:Transaction"];
    [companyField, investorField, amountField, dateField] = ["payee.name", "payers.name", "amount", "date"];
    if (series) {
      throw new DiffbotToolError("series applies to kind 'funding' only.");
    }
    if (industry) {
      throw new DiffbotToolError("industry applies to kind 'funding' or 'acquisitions'.");
    }
  }

  if (company) {
    clauses.push(clause(companyField, company));
  }
  if (investor || acquirer) {
    clauses.push(clause(investorField, (investor || acquirer) as string));
  }
  if (series) {
    clauses.push(clause("investment.series", series));
  }
  if (min_amount !== undefined) {
    clauses.push(compare(`${amountField}.value`, ">=", min_amount));
  }
  if (max_amount !== undefined) {
    clauses.push(compare(`${amountField}.value`, "<=", max_amount));
  }
  if (hasAmount && currency) {
    clauses.push(clause(`${amountField}.currency`, currency));
  }
  clauses.push(...dateRange(dateField, since, until));

  if (clauses.length === 1) {
    throw new DiffbotToolError("diffbot_search_deals needs at least one filter.");
  }

  if (facet) {
    const facetField = { series: "investment.series", investors: investorField, amount: `${amountField}.value` }[facet];
    if (kind === "any" && facet === "series") {
      throw new DiffbotToolError("facet 'series' applies to kind 'funding' only.");
    }
    clauses.push(`facet:${facetField}`);
  } else if (sort) {
    clauses.push(sortClause(sort === "newest" ? dateField : `${amountField}.value`));
  }
  const fields = DEFAULT_FIELDS[kind === "funding" ? "Investment" : "Transaction"];
  return { dql: build(clauses), fields, mode: "rows" };
}

/** json amounts arrive as floats; render integral ones as ints so rows match the csv form. */
export function plainNumber(value: unknown): unknown {
  if (typeof value === "number" && Number.isInteger(value)) {
    return Math.trunc(value);
  }
  return value;
}

export type InvestmentConditions = {
  series?: string;
  investor?: string;
  min_amount?: number;
  max_amount?: number;
  currency?: string;
  since?: string;
  until?: string;
};

function dateOf(investment: Record<string, unknown>): string {
  const date = isRecord(investment.date) && typeof investment.date.str === "string" ? investment.date.str : "";
  return cleanValue(date).slice(0, 10);
}

function investorsOf(investment: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(investment.investors) ? investment.investors.filter(isRecord) : [];
}

export function investmentMatches(investment: Record<string, unknown>, conditions: InvestmentConditions): boolean {
  const { series, investor, min_amount, max_amount, currency, since, until } = conditions;
  const amount = isRecord(investment.amount) ? investment.amount : {};
  const value = typeof amount.value === "number" ? amount.value : undefined;
  if (min_amount !== undefined && (value === undefined || value < min_amount)) {
    return false;
  }
  if (max_amount !== undefined && (value === undefined || value > max_amount)) {
    return false;
  }
  if ((min_amount !== undefined || max_amount !== undefined) && currency && amount.currency && amount.currency !== currency) {
    return false;
  }
  const investmentSeries = typeof investment.series === "string" ? investment.series : "";
  if (series && !investmentSeries.toLowerCase().includes(series.toLowerCase())) {
    return false;
  }
  if (
    investor &&
    !investorsOf(investment).some((i) => (typeof i.name === "string" ? i.name : "").toLowerCase().includes(investor.toLowerCase()))
  ) {
    return false;
  }
  const date = dateOf(investment);
  if (since && (!date || date < since)) {
    return false;
  }
  if (until && (!date || date > until)) {
    return false;
  }
  return true;
}

export function renderCompanyRounds(entity: Record<string, unknown>, conditions: InvestmentConditions): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const investments = Array.isArray(entity.investments) ? entity.investments.filter(isRecord) : [];
  for (const investment of investments) {
    if (!investmentMatches(investment, conditions)) {
      continue;
    }
    const amount = isRecord(investment.amount) ? investment.amount : {};
    const investors = investorsOf(investment)
      .map((i) => (typeof i.name === "string" ? i.name : ""))
      .filter(Boolean)
      .join(", ");
    const row: Record<string, unknown> = {
      Company: entity.name,
      Round: investment.series,
      Amount: plainNumber(amount.value),
      Currency: amount.currency,
      Date: dateOf(investment) || null,
      Investors: investors || null,
      "Company Id": entity.id,
    };
    rows.push(Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== null && value !== "")));
  }
  return rows;
}

export const dealsTool = defineTool({
  name: "diffbot_search_deals",
  label: "Diffbot Deal Search",
  description: DESCRIPTION,
  parameters: Type.Object({
    kind: Type.Optional(
      Type.Union([Type.Literal("funding"), Type.Literal("acquisitions"), Type.Literal("any")], {
        description: "'funding' for rounds, 'acquisitions' for M&A, 'any' for every transaction type.",
        default: "funding",
      }),
    ),
    company: Type.Optional(Type.String({ description: "The company raising or being acquired." })),
    investor: Type.Optional(Type.String({ description: "Investor name for funding rounds, e.g. 'Sequoia Capital'." })),
    acquirer: Type.Optional(Type.String({ description: "Acquirer name for acquisitions, e.g. 'Microsoft'." })),
    series: Type.Optional(
      Type.String({ description: "Round series, e.g. 'Series A'; contains-matched, so it also covers 'Series A-1'." }),
    ),
    min_amount: Type.Optional(Type.Number({ description: "Minimum deal size, e.g. 50000000." })),
    max_amount: Type.Optional(Type.Number({ description: "Maximum deal size." })),
    currency: Type.Optional(
      Type.String({ description: "Currency for the amount filter; values are not normalized across currencies.", default: "USD" }),
    ),
    since: Type.Optional(Type.String({ description: "Earliest deal date, YYYY-MM-DD." })),
    until: Type.Optional(Type.String({ description: "Latest deal date, YYYY-MM-DD." })),
    industry: Type.Optional(
      Type.String({
        description:
          "OrganizationCategory of the company, e.g. 'Artificial Intelligence Software'. Free text is resolved; ambiguous text returns candidates.",
      }),
    ),
    sort: Type.Optional(
      Type.Union([Type.Literal("newest"), Type.Literal("largest")], {
        description: "Leave unset unless the ordering is the question; unsorted results surface the headline deals.",
      }),
    ),
    facet: Type.Optional(
      Type.Union([Type.Literal("series"), Type.Literal("investors"), Type.Literal("amount")], {
        description:
          "Aggregate instead of listing: funding by stage, most active investors or acquirers, deal sizes; size becomes the bucket count.",
      }),
    ),
    size: Type.Optional(Type.Integer({ description: "Maximum number of deals (or buckets) to return.", minimum: 0, default: 10 })),
    offset: Type.Optional(Type.Integer({ description: "Number of deals to skip, for paging.", minimum: 0, default: 0 })),
  }),
  async execute(params, config, context) {
    const ctx = callContext(config, context.signal);
    const { series, investor, min_amount, max_amount, since, until, size, offset } = params;
    const kind = params.kind ?? "funding";
    const currency = params.currency ?? "USD";
    let { industry } = params;
    const notes: string[] = [];
    if (industry) {
      const resolved = await resolveValue(ctx, "OrganizationCategory", industry);
      if (resolved.value === undefined) {
        if (resolved.candidates.length > 0) {
          return { dql: null, candidates: { industry: resolved.candidates }, notes: [resolved.note ?? ""] };
        }
        throw new DiffbotToolError(resolved.note ?? "");
      }
      industry = resolved.value;
      if (resolved.note) {
        notes.push(resolved.note);
      }
    }

    const { dql: query, fields, mode } = buildDealsQuery({ ...params, kind, currency, industry });

    let result;
    if (mode === "industry") {
      result = await run(ctx, `${query} ${INDUSTRY_GET}`, {
        size: size ?? 10,
        offset: offset ?? 0,
        format: "json",
        bareTypeCheck: true,
      });
      const conditions: InvestmentConditions = { series, investor, min_amount, max_amount, currency, since, until };
      const rows: Record<string, unknown>[] = [];
      for (const entity of result.results ?? []) {
        rows.push(...renderCompanyRounds(isRecord(entity) ? entity : {}, conditions));
      }
      result.dql = query;
      result.results = rows;
      result.returned = rows.length;
      notes.push("hits counts companies in the industry with a matching round; results list each matching round per company.");
    } else {
      result = await run(ctx, query, { size: size ?? 10, offset: offset ?? 0, fields, bareTypeCheck: true });
    }

    if (notes.length > 0) {
      result.notes = [...(result.notes ?? []), ...notes];
    }
    return result;
  },
});
