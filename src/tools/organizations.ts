import { Type } from "typebox";

import { callContext, DiffbotToolError } from "../api.js";
import { build, clause, compare, looksLikeDomain, nearClause, orClause, sortClause, validateDate } from "../dql-builder.js";
import { DEFAULT_FIELDS, resolveValue, run } from "../dql.js";
import { defineTool } from "./shared.js";

const DESCRIPTION =
  "Searches companies and organizations in the Diffbot Knowledge Graph by industry, headquarters, headcount, " +
  "revenue, funding, ownership, or leadership, plus similar_to lookalike lists for competitor mapping. USE THIS " +
  "when the answer is a list of companies: prospecting, market maps, competitor sets, who-does-X, everything a " +
  "company acquired, everything an investor backed. Rows are companies, not deals. industry is the best first " +
  "filter and is resolved against the OrganizationCategory taxonomy; descriptors is the free-text fallback for a " +
  "niche. Location is the headquarters unless any_office is set. A specific company is matched by name exactly " +
  "or better by homepage domain. Set facet for distribution questions. Returns the DQL it ran; refine with diffbot_dql " +
  "when the shape is outside these parameters.";

export type OrganizationsSort = "employees" | "revenue" | "founded" | "importance";
const SORT_FIELDS: Record<OrganizationsSort, string> = {
  employees: "nbEmployees",
  revenue: "revenue.value",
  founded: "foundingDate",
  importance: "importance",
};

export type OrganizationsQueryOptions = {
  name?: string;
  name_match?: "strict" | "contains";
  homepage?: string;
  industry?: string[];
  descriptors?: string;
  city?: string;
  region?: string;
  country?: string;
  any_office?: boolean;
  near?: string;
  radius?: string;
  min_employees?: number;
  max_employees?: number;
  min_revenue?: number;
  is_public?: boolean;
  founded_after?: string;
  founded_before?: string;
  investor?: string;
  acquired_by?: string;
  similar_to?: string;
  sort?: OrganizationsSort;
  facet?: string;
};

/** industry values must already be exact OrganizationCategory names. */
export function buildOrganizationsQuery(options: OrganizationsQueryOptions = {}): string {
  const {
    name,
    name_match = "strict",
    homepage,
    industry,
    descriptors,
    city,
    region,
    country,
    any_office = false,
    near,
    radius,
    min_employees,
    max_employees,
    min_revenue,
    is_public,
    founded_after,
    founded_before,
    investor,
    acquired_by,
    similar_to,
    sort,
    facet,
  } = options;
  const clauses = ["type:Organization"];

  if (similar_to) {
    const anchor = looksLikeDomain(similar_to) ? clause("homepageUri", similar_to) : clause("name", similar_to);
    clauses.push(`similarTo(${anchor})`);
  }
  if (name) {
    clauses.push(clause("name", name, name_match === "strict"));
  }
  if (homepage) {
    clauses.push(clause("homepageUri", homepage));
  }
  if (industry && industry.length > 0) {
    clauses.push(orClause("categories.name", industry));
  }
  if (descriptors) {
    clauses.push(clause("descriptors", descriptors));
  }

  // singular location is the headquarters; plural locations is any office
  const prefix = any_office ? "locations" : "location";
  for (const [level, value] of [
    ["city", city],
    ["region", region],
    ["country", country],
  ] as const) {
    if (value) {
      clauses.push(clause(`${prefix}.${level}.name`, value));
    }
  }
  if (near) {
    clauses.push(nearClause(near, radius));
  }

  if (min_employees !== undefined) {
    clauses.push(compare("nbEmployees", ">=", min_employees));
  }
  if (max_employees !== undefined) {
    clauses.push(compare("nbEmployees", "<=", max_employees));
  }
  if (min_revenue !== undefined) {
    clauses.push(compare("revenue.value", ">=", min_revenue));
  }
  if (is_public !== undefined) {
    clauses.push(`isPublic:${is_public ? "true" : "false"}`);
  }
  if (founded_after) {
    clauses.push(compare("foundingDate", ">=", validateDate(founded_after, "founded_after") as string));
  }
  if (founded_before) {
    clauses.push(compare("foundingDate", "<=", validateDate(founded_before, "founded_before") as string));
  }
  if (investor) {
    clauses.push(clause("investments.investors.name", investor));
  }
  if (acquired_by) {
    clauses.push("isAcquired:true");
    clauses.push(clause("acquiredBy.name", acquired_by));
  }

  if (clauses.length === 1) {
    throw new DiffbotToolError("diffbot_search_organizations needs at least one filter.");
  }

  if (facet) {
    clauses.push(`facet:${facet}`);
  } else if (sort) {
    clauses.push(sortClause(SORT_FIELDS[sort], true));
  }
  return build(clauses);
}

export const organizationsTool = defineTool({
  name: "diffbot_search_organizations",
  label: "Diffbot Organization Search",
  description: DESCRIPTION,
  parameters: Type.Object({
    name: Type.Optional(
      Type.String({
        description:
          "Company name, matched exactly by default (contains-matching over-matches badly). Large companies have duplicate records; the top row is the primary one.",
      }),
    ),
    name_match: Type.Optional(
      Type.Union([Type.Literal("strict"), Type.Literal("contains")], {
        description: "'contains' only when strict returns nothing or the name is a kind of company rather than a specific one.",
        default: "strict",
      }),
    ),
    homepage: Type.Optional(Type.String({ description: "Homepage domain, e.g. 'tesla.com'; the most reliable way to pin one company." })),
    industry: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "OrganizationCategory values, OR-ed, e.g. ['Semiconductor Companies']. Free text is resolved; ambiguous text returns candidates.",
      }),
    ),
    descriptors: Type.Optional(
      Type.String({ description: "Free-text capability tag, e.g. 'GPU'; the fallback when no industry fits." }),
    ),
    city: Type.Optional(Type.String({ description: "Headquarters city." })),
    region: Type.Optional(Type.String({ description: "Headquarters state, province, or region." })),
    country: Type.Optional(Type.String({ description: "Headquarters country, full name, e.g. 'United States'." })),
    any_office: Type.Optional(
      Type.Boolean({ description: "Match any office in the given location rather than the headquarters.", default: false }),
    ),
    near: Type.Optional(Type.String({ description: "Place to search around, e.g. 'Austin'; use for 'near' or 'within X miles'." })),
    radius: Type.Optional(Type.String({ description: "Radius for near, e.g. '30mi' or '50km'. Defaults to 15km." })),
    min_employees: Type.Optional(Type.Integer({ description: "Minimum headcount." })),
    max_employees: Type.Optional(Type.Integer({ description: "Maximum headcount." })),
    min_revenue: Type.Optional(Type.Number({ description: "Minimum annual revenue." })),
    is_public: Type.Optional(Type.Boolean({ description: "Publicly traded or not." })),
    founded_after: Type.Optional(Type.String({ description: "Earliest founding date, YYYY-MM-DD." })),
    founded_before: Type.Optional(Type.String({ description: "Latest founding date, YYYY-MM-DD." })),
    investor: Type.Optional(Type.String({ description: "Investor name; returns its portfolio companies." })),
    acquired_by: Type.Optional(Type.String({ description: "Acquirer name; returns the companies it acquired." })),
    similar_to: Type.Optional(
      Type.String({
        description:
          "Anchor company (name or homepage domain) for a lookalike list of exactly size companies; other filters narrow within the ranking.",
      }),
    ),
    sort: Type.Optional(
      Type.Union([Type.Literal("employees"), Type.Literal("revenue"), Type.Literal("founded"), Type.Literal("importance")], {
        description: "Leave unset unless the ordering is the question; the default ranking is better.",
      }),
    ),
    facet: Type.Optional(
      Type.String({
        description: "Aggregate into buckets instead of rows, e.g. 'categories.name'; size becomes the bucket count.",
      }),
    ),
    size: Type.Optional(
      Type.Integer({ description: "Maximum number of companies (or buckets) to return.", minimum: 0, default: 10 }),
    ),
    offset: Type.Optional(Type.Integer({ description: "Number of companies to skip, for paging.", minimum: 0, default: 0 })),
  }),
  async execute(params, config, context) {
    const ctx = callContext(config, context.signal);
    const { industry, size, offset } = params;
    let { descriptors } = params;
    const notes: string[] = [];
    const resolvedIndustry: string[] = [];
    for (const value of industry ?? []) {
      const resolved = await resolveValue(ctx, "OrganizationCategory", value);
      if (resolved.value === undefined) {
        if (resolved.candidates.length > 0) {
          return { dql: null, candidates: { industry: resolved.candidates }, notes: [resolved.note ?? ""] };
        }
        notes.push(`${resolved.note ?? ""}; matched descriptors on '${value}' instead.`);
        descriptors = descriptors || value;
      } else {
        resolvedIndustry.push(resolved.value);
        if (resolved.note) {
          notes.push(resolved.note);
        }
      }
    }

    const query = buildOrganizationsQuery({ ...params, industry: resolvedIndustry, descriptors });
    const result = await run(ctx, query, {
      size: size ?? 10,
      offset: offset ?? 0,
      fields: DEFAULT_FIELDS.Organization,
      bareTypeCheck: true,
    });
    if (notes.length > 0) {
      result.notes = [...(result.notes ?? []), ...notes];
    }
    return result;
  },
});
