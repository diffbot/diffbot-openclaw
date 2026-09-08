import { Type } from "typebox";

import { callContext, DiffbotToolError } from "../api.js";
import { enumValues, findNamed, getOntology, ontologyFields, ontologyNames, taxonomyValues } from "../dql.js";
import { defineTool } from "./shared.js";

const DESCRIPTION =
  "Looks up the entity types, fields, taxonomies, and enums that make up the Diffbot Knowledge Graph. Use before " +
  "writing a diffbot_dql query to confirm that a field path exists and to find the exact spelling of a taxonomy or enum " +
  "value, since a guessed field name is silently ignored and a guessed value returns zero. 'types', " +
  "'composites', 'enums' and 'taxonomies' list the available names; 'fields' lists the fields of one entity type " +
  "or composite (Organization, Location, Employment); 'taxonomy' and 'enum' list the values one may hold " +
  "(OrganizationCategory, ArticleCategory, Language, Gender); 'search' finds a name anywhere in the ontology when " +
  "its location is unknown. Deprecated fields are omitted. A query may descend from a composite or linked field " +
  "into its own fields, as in location.city.name or employments.employer.categories.name.";

const ACTIONS = ["types", "composites", "enums", "taxonomies", "fields", "taxonomy", "enum", "search"] as const;

export const dqlOntologyTool = defineTool({
  name: "diffbot_dql_ontology",
  label: "Diffbot DQL Ontology",
  description: DESCRIPTION,
  parameters: Type.Object({
    action: Type.Union(
      ACTIONS.map((value) => Type.Literal(value)),
      {
        description:
          "The lookup to perform. 'fields', 'taxonomy' and 'enum' require name. 'search' requires search.",
      },
    ),
    name: Type.Optional(
      Type.String({
        description:
          "The entity type or composite to list fields of (e.g. 'Organization', 'Location'), or the taxonomy or enum to list values of. Required for 'fields', 'taxonomy' and 'enum'.",
      }),
    ),
    search: Type.Optional(
      Type.String({
        description:
          "A regular expression, matched case insensitively, to filter results by name. Required for 'search' and optional for 'fields' and 'taxonomy'.",
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        description:
          "Maximum number of results to return. The total is always reported so a truncated lookup can be narrowed with search. Defaults to 100.",
        minimum: 1,
        default: 100,
      }),
    ),
  }),
  async execute({ action, name, search, limit }, config, context) {
    const ctx = callContext(config, context.signal);
    const max = limit ?? 100;
    let pattern: RegExp | undefined;
    if (search) {
      try {
        pattern = new RegExp(search, "i");
      } catch (error) {
        throw new DiffbotToolError(`search is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if ((action === "fields" || action === "taxonomy" || action === "enum") && !name) {
      throw new DiffbotToolError(`name is required for action '${action}'`);
    }
    if (action === "search" && !pattern) {
      throw new DiffbotToolError("search is required for action 'search'");
    }

    const ontology = await getOntology(ctx);
    let results: unknown[];
    switch (action) {
      case "types":
      case "composites":
      case "enums":
      case "taxonomies":
        results = ontologyNames(ontology, action);
        break;
      case "fields":
        results = ontologyFields(ontology, name as string, pattern);
        break;
      case "taxonomy":
        results = taxonomyValues(ontology, name as string, pattern);
        break;
      case "enum":
        results = enumValues(ontology, name as string);
        break;
      default:
        results = findNamed(ontology, pattern as RegExp);
    }

    return {
      action,
      total: results.length,
      returned: Math.min(results.length, max),
      results: results.slice(0, max),
    };
  },
});
