import { Type } from "typebox";

import { callContext, DiffbotToolError } from "../api.js";
import { build, clause, compare, nameVariants, nearClause, orClause, sortClause } from "../dql-builder.js";
import { PLACE_FIELDS, run } from "../dql.js";
import { defineTool } from "./shared.js";

const DESCRIPTION =
  "Searches geographic entities in the Diffbot Knowledge Graph: cities, counties, subregions, states, provinces, " +
  "countries, and points of interest, by name, population, prominence, containing place, or proximity. USE THIS " +
  "when the answer is a list of places or a sourced fact about one such as its population; prefer it over " +
  "recalling geographic figures. Rows are places. Set kind to the narrowest type that fits, since type:Place " +
  "alone spans 18.5M records including 12M points of interest. Accented names are searched in both spellings. " +
  "There is no continent field; continent is text-matched and over-inclusive. The KG holds duplicate records for " +
  "the same place (city proper vs metro), so collapse same-name rows in the same parent and say which figure was " +
  "kept. Returns the DQL it ran.";

export type PlaceKind = "city" | "subregion" | "region" | "country" | "administrative_area" | "poi" | "any";
const KIND_CLAUSES: Record<PlaceKind, string> = {
  city: "type:City",
  subregion: "type:Subregion",
  region: "type:Region",
  country: "type:Country",
  administrative_area: "type:AdministrativeArea",
  poi: 'type:Place not(types:"AdministrativeArea")',
  any: "type:Place",
};
export type PlacesSort = "population" | "importance";

export type PlacesQueryOptions = {
  kind?: PlaceKind;
  name?: string;
  descriptors?: string;
  country?: string;
  region?: string;
  subregion?: string;
  within?: string;
  continent?: string;
  near?: string;
  radius?: string;
  min_population?: number;
  max_population?: number;
  sort?: PlacesSort;
  facet?: "placeType";
};

/** Return {dql, notes}. */
export function buildPlacesQuery(options: PlacesQueryOptions = {}): { dql: string; notes: string[] } {
  const {
    kind = "any",
    name,
    descriptors,
    country,
    region,
    subregion,
    within,
    continent,
    near,
    radius,
    min_population,
    max_population,
    sort,
    facet,
  } = options;
  const clauses = [KIND_CLAUSES[kind]];
  const notes: string[] = [];

  if (name) {
    // diacritics are not normalized and coverage of each spelling is inconsistent
    clauses.push(orClause("name", nameVariants(name), true));
  }
  if (descriptors) {
    clauses.push(clause("descriptors", descriptors));
  }
  for (const [level, value] of [
    ["country", country],
    ["region", region],
    ["subregion", subregion],
  ] as const) {
    if (value) {
      clauses.push(clause(`location.${level}.name`, value));
    }
  }
  if (within) {
    clauses.push(clause("isPartOf.name", within));
  }
  if (continent) {
    clauses.push(clause("description", `in ${continent}`));
    notes.push(
      `There is no continent field; '${continent}' was matched against the prose description, which is over-inclusive and double-counts duplicate records. Filter the list before presenting it and say it was text-matched.`,
    );
  }
  if (near) {
    clauses.push(nearClause(near, radius));
  }
  if (min_population !== undefined) {
    clauses.push(compare("population", ">=", min_population));
  }
  if (max_population !== undefined) {
    clauses.push(compare("population", "<=", max_population));
  }

  if (clauses.length === 1 && (kind === "any" || kind === "administrative_area" || kind === "poi")) {
    throw new DiffbotToolError("diffbot_search_places needs a name, containing place, or other filter for this kind.");
  }

  if (facet) {
    clauses.push(`facet:${facet}`);
  } else if (sort) {
    clauses.push(sortClause(sort, true));
  }
  return { dql: build(clauses), notes };
}

export const placesTool = defineTool({
  name: "diffbot_search_places",
  label: "Diffbot Place Search",
  description: DESCRIPTION,
  parameters: Type.Object({
    kind: Type.Optional(
      Type.Union(
        [
          Type.Literal("city"),
          Type.Literal("subregion"),
          Type.Literal("region"),
          Type.Literal("country"),
          Type.Literal("administrative_area"),
          Type.Literal("poi"),
          Type.Literal("any"),
        ],
        {
          description:
            "'country' (634), 'region' for states and provinces, 'subregion' for counties, 'city', 'administrative_area' for all four, 'poi' for parks, landmarks and venues, 'any'.",
          default: "any",
        },
      ),
    ),
    name: Type.Optional(
      Type.String({
        description: "Place name, matched exactly in accented and plain spelling. Add country or region to pin one of many.",
      }),
    ),
    descriptors: Type.Optional(Type.String({ description: "Free-text descriptor, e.g. 'national park'; mostly for kind 'poi'." })),
    country: Type.Optional(Type.String({ description: "Containing country, full name." })),
    region: Type.Optional(Type.String({ description: "Containing state, province, or region." })),
    subregion: Type.Optional(Type.String({ description: "Containing county or district." })),
    within: Type.Optional(
      Type.String({ description: "Any containing place at any level; use country/region/subregion when the level matters." }),
    ),
    continent: Type.Optional(
      Type.String({ description: "Continent name; text-matched because no continent field exists, so over-inclusive." }),
    ),
    near: Type.Optional(Type.String({ description: "Place to search around, e.g. 'Paris'." })),
    radius: Type.Optional(Type.String({ description: "Radius for near, e.g. '50km' or '20mi'. Defaults to 15km." })),
    min_population: Type.Optional(Type.Integer({ description: "Minimum population." })),
    max_population: Type.Optional(Type.Integer({ description: "Maximum population." })),
    sort: Type.Optional(
      Type.Union([Type.Literal("population"), Type.Literal("importance")], {
        description: "Leave unset unless the ordering is the question ('largest cities').",
      }),
    ),
    facet: Type.Optional(
      Type.Union([Type.Literal("placeType")], {
        description: "'placeType' shows what mix of cities, subregions, and points of interest a name spans.",
      }),
    ),
    size: Type.Optional(Type.Integer({ description: "Maximum number of places to return.", minimum: 0, default: 10 })),
    offset: Type.Optional(Type.Integer({ description: "Number of places to skip, for paging.", minimum: 0, default: 0 })),
  }),
  async execute(params, config, context) {
    const ctx = callContext(config, context.signal);
    const { name, size, offset } = params;
    const { dql: query, notes } = buildPlacesQuery({ ...params, kind: params.kind ?? "any" });
    const result = await run(ctx, query, { size: size ?? 10, offset: offset ?? 0, fields: PLACE_FIELDS, bareTypeCheck: true });
    if (result.hits === 0 && name) {
      notes.push("Zero hits for both spellings of the name. Try kind 'any', or match on country/region without the name.");
    }
    if (notes.length > 0) {
      result.notes = [...(result.notes ?? []), ...notes];
    }
    return result;
  },
});
