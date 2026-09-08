import { Type } from "typebox";

import { callContext } from "../api.js";
import { run } from "../dql.js";
import { defineTool } from "./shared.js";

const DESCRIPTION =
  "Searches the Diffbot Knowledge Graph with DQL, a structured query language over billions of organizations, " +
  "people, articles, products, places, and deals. Prefer the typed tools (diffbot_search_news, diffbot_search_organizations, " +
  "diffbot_search_people, diffbot_search_places, diffbot_search_deals) when the question fits one; each returns the DQL it ran, which " +
  "can be refined here. Use diffbot_dql directly for other entity types (Product, Patent, Brand, JobPost, ... listed by " +
  "diffbot_dql_ontology 'types'), cross-entity shapes, or the id filter from diffbot_resolve_entities.\n" +
  "Syntax: every query starts with type:X and space-separated conditions AND together. field:\"value\" is " +
  "CONTAINS (name:\"Apple\" matches 68,068 organizations); strict:field:\"value\" is exact (1,426; " +
  "strict:name:\"Apple Inc.\" is 1); re:field:\"pattern\" is regex and slow; field>N, field<N, field!=v, " +
  "range:field:N-M, min:field:N, max:field:N; field:or(\"a\",\"b\"); not(condition); has:field; " +
  "near(type:Place name:\"Austin\", 30mi); similarTo(name:\"OpenAI\") for Organization only, which returns " +
  "exactly size rows ranked by similarity with no meaningful hit count; sortBy:field and revSortBy:field; " +
  "facet:field returns bucket counts instead of rows and size is then the number of buckets; get:a,b adds fields " +
  "that the default payload omits (ceo, founders, population, isPartOf) and only matters with format 'json'.\n" +
  "Rules that decide correctness: (1) Conditions on the same nested list object go inside one {}: " +
  "employments.{employer.name:\"Nvidia\" isCurrent:true}. Written loosely they match different jobs and inflate " +
  "counts about 9x. (2) Singular fields hold the primary value (location is the headquarters, name, homepageUri); " +
  "plural ones (locations, allNames, allUris) include secondary and historical values. (3) Confirm field paths " +
  "and taxonomy values with diffbot_dql_ontology: an unknown path is silently ignored and returns the unfiltered type " +
  "count, and categories.name values are title-cased and often plural (\"Semiconductor Companies\"). (4) Do not " +
  "add a sort unless the ordering is the question; the default ranking encodes relevance and prominence and an " +
  "explicit sort overrides it for the worse. Articles are the exception and should end with sortBy:date. " +
  "(5) Compare dates against the field with a full date, as in date>=\"2024-01-01\"; the .str form belongs in " +
  "fields as a column, not in a comparison. (6) Probe candidate variants with diffbot_dql_probe before pulling rows, and " +
  "never probe an unfiltered type:Article. (7) Read summary rather than text on Article results.";

export const dqlTool = defineTool({
  name: "diffbot_dql",
  label: "Diffbot DQL",
  description: DESCRIPTION,
  parameters: Type.Object({
    query: Type.String({
      description:
        "The DQL query. Must begin with a type: clause, e.g. 'type:Organization location.country.name:\"United States\" nbEmployees>500'.",
    }),
    size: Type.Optional(
      Type.Integer({ description: "Maximum number of records (or facet buckets) to return. Defaults to 10.", minimum: 0, default: 10 }),
    ),
    offset: Type.Optional(
      Type.Integer({ description: "Number of records to skip, for paging through a result set.", minimum: 0, default: 0 }),
    ),
    fields: Type.Optional(
      Type.String({
        description:
          "Optional, csv format only. The columns to return as ';'-separated '<dql.field.path>,<Display Name>' pairs, e.g. 'name,Name;nbEmployees,Employees;location.city.name,City'. Defaults to a summary set for the queried entity type. Use lowercase field paths; for list fields only the primary value is rendered.",
      }),
    ),
    format: Type.Optional(
      Type.Union([Type.Literal("csv"), Type.Literal("json")], {
        description:
          "'csv' returns compact rows of the requested columns. 'json' returns full entity records, which run to ~75kb each, so add get:field,... to the query to limit them; needed when a list field must be read in full (every investor, every employment) or a field is absent from the csv. Defaults to csv.",
        default: "csv",
      }),
    ),
    hits_only: Type.Optional(
      Type.Boolean({
        description:
          "Return only the number of matching records, with no data. Use diffbot_dql_probe to compare several variants at once.",
        default: false,
      }),
    ),
  }),
  async execute({ query, size, offset, fields, format, hits_only }, config, context) {
    const ctx = callContext(config, context.signal);
    return run(ctx, query, {
      size: size ?? 10,
      offset: offset ?? 0,
      fields,
      format: format ?? "csv",
      hitsOnly: hits_only ?? false,
    });
  },
});
