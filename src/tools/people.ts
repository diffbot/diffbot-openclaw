import { Type } from "typebox";

import { callContext, DiffbotToolError, isRecord } from "../api.js";
import { build, clause, compare, expandTitles, looksLikeDomain, orClause, sortClause, subquery } from "../dql-builder.js";
import { DEFAULT_FIELDS, resolveValue, run } from "../dql.js";
import { defineTool } from "./shared.js";

const DESCRIPTION =
  "Searches people in the Diffbot Knowledge Graph by job title, employer, employer industry, skills, education, " +
  "location, or nationality. USE THIS when the answer is a list of people: executives at a company, alumni of a " +
  "school, who holds a role, who has a skill, who runs a company. Rows are people, not companies. Every " +
  "employment condition is co-constrained on one job, C-suite titles are expanded to both their spelled-out and " +
  "abbreviated forms, and the Title and Employer columns show the job that matched rather than the person's " +
  "primary one. For the CEO or founders of one named company use leadership_of, which reads the curated fields " +
  "on the Organization instead of scanning people. Coverage is people with a public online professional presence " +
  "only: an empty result means not publicly documented, never that a person or role does not exist, and counts " +
  "are a floor, not a headcount. Not a people-finder for private individuals. Returns the DQL it ran.";

export type PeopleSort = "importance" | "net_worth";
const SORT_FIELDS: Record<PeopleSort, string> = { importance: "importance", net_worth: "netWorth.value" };
export const LEADERSHIP_GET = "get:name,ceo,founders";
export const MATCHED_GET = "get:id,name,employments,location,linkedInUri";

export type PeopleQueryOptions = {
  name?: string;
  title?: string[];
  employer?: string;
  employer_industry?: string;
  employer_country?: string;
  employer_min_employees?: number;
  current?: boolean;
  school?: string;
  major?: string;
  degree?: string;
  skill?: string[];
  city?: string;
  region?: string;
  country?: string;
  nationality?: string;
  gender?: string;
  min_net_worth?: number;
  sort?: PeopleSort;
};

/** employer_industry and gender must already be exact taxonomy/enum values. */
export function buildPeopleQuery(options: PeopleQueryOptions = {}): string {
  const {
    name,
    title,
    employer,
    employer_industry,
    employer_country,
    employer_min_employees,
    current = true,
    school,
    major,
    degree,
    skill,
    city,
    region,
    country,
    nationality,
    gender,
    min_net_worth,
    sort,
  } = options;
  const clauses = ["type:Person"];
  if (name) {
    clauses.push(clause("name", name, true));
  }

  // every condition about one job goes inside one {}; written separately they match
  // different jobs and inflate the count roughly nine times
  const employment: string[] = [];
  if (title && title.length > 0) {
    employment.push(orClause("title", expandTitles(title)));
  }
  if (employer) {
    employment.push(clause("employer.name", employer));
  }
  if (employer_industry) {
    employment.push(clause("employer.categories.name", employer_industry));
  }
  if (employer_country) {
    employment.push(clause("employer.location.country.name", employer_country));
  }
  if (employer_min_employees !== undefined) {
    employment.push(compare("employer.nbEmployees", ">=", employer_min_employees));
  }
  if (employment.length > 0 && current) {
    employment.push("isCurrent:true");
  }
  clauses.push(subquery("employments", employment));

  const education: string[] = [];
  if (school) {
    education.push(clause("institution.name", school));
  }
  if (major) {
    education.push(clause("major.name", major));
  }
  if (degree) {
    education.push(clause("degree.name", degree));
  }
  clauses.push(subquery("educations", education));

  if (skill && skill.length > 0) {
    clauses.push(orClause("skills.name", skill));
  }
  for (const [level, value] of [
    ["city", city],
    ["region", region],
    ["country", country],
  ] as const) {
    if (value) {
      clauses.push(clause(`location.${level}.name`, value));
    }
  }
  if (nationality) {
    clauses.push(clause("nationalities.name", nationality));
  }
  if (gender) {
    clauses.push(clause("gender", gender));
  }
  if (min_net_worth !== undefined) {
    clauses.push(compare("netWorth.value", ">=", min_net_worth));
  }

  if (clauses.filter(Boolean).length === 1) {
    throw new DiffbotToolError("diffbot_search_people needs at least one filter.");
  }
  if (sort) {
    clauses.push(sortClause(SORT_FIELDS[sort], true));
  }
  return build(clauses);
}

export function buildLeadershipQuery(company: string): string {
  // the domain plus the default ranking is right for apple.com, tesla.com, openai.com and
  // friends, where strict:name misses (Apple Inc.) and a sort surfaces the wrong record
  const anchor = looksLikeDomain(company) ? clause("homepageUri", company) : clause("name", company);
  return build(["type:Organization", anchor, LEADERSHIP_GET]);
}

export type Employment = Record<string, unknown>;

function nameOf(value: unknown): string {
  return isRecord(value) && typeof value.name === "string" ? value.name : "";
}

/** The employment that best matches the filters, so rendered columns reflect the matched job rather than the primary one. */
export function pickEmployment(
  employments: Employment[],
  employer: string | undefined,
  titles: string[],
  current: boolean,
): Employment {
  const score = (job: Employment): number => {
    let points = 0;
    const employerName = nameOf(job.employer).toLowerCase();
    if (employer && employerName.includes(employer.toLowerCase())) {
      points += 4;
    }
    const jobTitle = (typeof job.title === "string" ? job.title : "").toLowerCase();
    if (titles.length > 0 && titles.some((t) => jobTitle.includes(t.toLowerCase()))) {
      points += 2;
    }
    if (current && job.isCurrent) {
      points += 1;
    }
    return points;
  };

  let best: Employment | undefined;
  let bestScore = -Infinity;
  for (const job of employments) {
    const points = score(job);
    if (best === undefined || points > bestScore) {
      best = job;
      bestScore = points;
    }
  }
  return best ?? {};
}

export function renderPerson(
  entity: Record<string, unknown>,
  employer: string | undefined,
  titles: string[],
  current: boolean,
): Record<string, unknown> {
  const employments = Array.isArray(entity.employments) ? entity.employments.filter(isRecord) : [];
  const job = pickEmployment(employments, employer, titles, current);
  const location = isRecord(entity.location) ? entity.location : {};
  const row: Record<string, unknown> = {
    Name: entity.name,
    Title: job.title,
    Employer: isRecord(job.employer) ? job.employer.name : undefined,
    City: isRecord(location.city) ? location.city.name : undefined,
    Country: isRecord(location.country) ? location.country.name : undefined,
    LinkedIn: entity.linkedInUri,
    Id: entity.id,
  };
  return Object.fromEntries(Object.entries(row).filter(([, value]) => Boolean(value)));
}

export const peopleTool = defineTool({
  name: "diffbot_search_people",
  label: "Diffbot People Search",
  description: DESCRIPTION,
  parameters: Type.Object({
    name: Type.Optional(Type.String({ description: "Person's name, matched exactly. Expect several rows for one individual." })),
    title: Type.Optional(
      Type.Array(Type.String(), {
        description: "Job titles, OR-ed. CEO, CTO, CFO, COO, CIO, CMO and 'board member' are expanded to every spelling.",
      }),
    ),
    employer: Type.Optional(Type.String({ description: "Employer name, e.g. 'Nvidia'." })),
    employer_industry: Type.Optional(
      Type.String({
        description:
          "OrganizationCategory of the employer, e.g. 'Biotechnology Companies'. Free text is resolved; ambiguous text returns candidates.",
      }),
    ),
    employer_country: Type.Optional(Type.String({ description: "Country of the employer's headquarters, full name." })),
    employer_min_employees: Type.Optional(Type.Integer({ description: "Minimum headcount of the employer." })),
    current: Type.Optional(
      Type.Boolean({ description: "Only current employment; set false for history (everyone who has worked at X).", default: true }),
    ),
    school: Type.Optional(Type.String({ description: "Educational institution, e.g. 'Stanford University'." })),
    major: Type.Optional(Type.String({ description: "Field of study, e.g. 'Computer Science'." })),
    degree: Type.Optional(Type.String({ description: "Degree name, e.g. 'MBA'." })),
    skill: Type.Optional(Type.Array(Type.String(), { description: "Skills, OR-ed, e.g. ['Machine Learning']." })),
    city: Type.Optional(Type.String({ description: "City of primary residence." })),
    region: Type.Optional(Type.String({ description: "State, province, or region of primary residence." })),
    country: Type.Optional(Type.String({ description: "Country of primary residence, full name." })),
    nationality: Type.Optional(Type.String({ description: "Nationality as a country name, e.g. 'France'." })),
    gender: Type.Optional(Type.String({ description: "Gender enum value, e.g. 'Female'." })),
    min_net_worth: Type.Optional(
      Type.Number({ description: "Minimum net worth; the top of the range holds bad outliers, so sanity-check rows." }),
    ),
    sort: Type.Optional(
      Type.Union([Type.Literal("importance"), Type.Literal("net_worth")], {
        description: "Leave unset unless the ordering is the question; the default ranking already orders by importance.",
      }),
    ),
    leadership_of: Type.Optional(
      Type.String({
        description:
          "A company's homepage domain (preferred) or name; returns its CEO and founders from the curated Organization fields. Other filters are ignored.",
      }),
    ),
    size: Type.Optional(Type.Integer({ description: "Maximum number of people to return.", minimum: 0, default: 10 })),
    offset: Type.Optional(Type.Integer({ description: "Number of people to skip, for paging.", minimum: 0, default: 0 })),
  }),
  async execute(params, config, context) {
    const ctx = callContext(config, context.signal);
    const { title, employer, leadership_of, size, offset } = params;
    const current = params.current ?? true;
    let { employer_industry, gender } = params;

    if (leadership_of) {
      const result = await run(ctx, buildLeadershipQuery(leadership_of), { size: 1, format: "json" });
      const records = result.results ?? [];
      const entity = records.length > 0 && isRecord(records[0]) ? records[0] : undefined;
      if (!entity) {
        return {
          dql: result.dql,
          hits: result.hits,
          company: null,
          ceo: null,
          founders: [],
          notes: ["No organization matched. Prefer the homepage domain over the name."],
        };
      }
      const founders = Array.isArray(entity.founders) ? entity.founders : [];
      return {
        dql: result.dql,
        hits: result.hits,
        company: entity.name ?? null,
        ceo: (isRecord(entity.ceo) ? entity.ceo.name : undefined) ?? null,
        founders: founders.map(nameOf).filter(Boolean),
      };
    }

    const notes: string[] = [];
    if (employer_industry) {
      const resolved = await resolveValue(ctx, "OrganizationCategory", employer_industry);
      if (resolved.value === undefined) {
        if (resolved.candidates.length > 0) {
          return { dql: null, candidates: { employer_industry: resolved.candidates }, notes: [resolved.note ?? ""] };
        }
        throw new DiffbotToolError(resolved.note ?? "");
      }
      employer_industry = resolved.value;
      if (resolved.note) {
        notes.push(resolved.note);
      }
    }
    if (gender) {
      const resolved = await resolveValue(ctx, "Gender", gender, "enum");
      if (resolved.value === undefined) {
        throw new DiffbotToolError(resolved.note ?? "");
      }
      gender = resolved.value;
    }

    const query = buildPeopleQuery({ ...params, current, employer_industry, gender });

    // with an employer or title filter the rendered job must be the one that matched, not
    // the primary one, so the records are read as json and the matching employment picked
    let result;
    if (employer || (title && title.length > 0)) {
      result = await run(ctx, `${query} ${MATCHED_GET}`, {
        size: size ?? 10,
        offset: offset ?? 0,
        format: "json",
        bareTypeCheck: true,
      });
      const titles = expandTitles(title ?? []);
      result.results = (result.results ?? []).map((entity) => renderPerson(isRecord(entity) ? entity : {}, employer, titles, current));
      result.dql = query;
    } else {
      result = await run(ctx, query, {
        size: size ?? 10,
        offset: offset ?? 0,
        fields: DEFAULT_FIELDS.Person,
        bareTypeCheck: true,
      });
    }

    if (notes.length > 0) {
      result.notes = [...(result.notes ?? []), ...notes];
    }
    return result;
  },
});
