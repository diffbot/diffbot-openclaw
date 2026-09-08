import { Type } from "typebox";

import { callContext } from "../api.js";
import { probe } from "../dql.js";
import { defineTool } from "./shared.js";

const DESCRIPTION =
  "Returns the hit count of several DQL queries at once, run in parallel, so candidate variants can be compared " +
  "before pulling rows: the {} co-constrained form against the loose form, a category filter against a " +
  "descriptors filter, with and without a location. Aim for a few hundred to a few thousand hits. Two failure " +
  "signatures: zero hits means a value is wrong for the field (check diffbot_dql_ontology), and a count equal to the " +
  "bare type:X count means a field path was silently ignored. similarTo queries cannot be probed and are " +
  "reported as errors. Never probe an unfiltered type:Article; the article index is large enough that it times out.";

export const dqlProbeTool = defineTool({
  name: "diffbot_dql_probe",
  label: "Diffbot DQL Probe",
  description: DESCRIPTION,
  parameters: Type.Object({
    queries: Type.Array(Type.String(), {
      description: "The DQL queries to count. Each must begin with a type: clause.",
      minItems: 1,
    }),
  }),
  async execute({ queries }, config, context) {
    const ctx = callContext(config, context.signal);
    return { results: await probe(ctx, queries) };
  },
});
