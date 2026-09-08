import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import { configSchema } from "./config.js";
import { crawlTool } from "./tools/crawl.js";
import { dealsTool } from "./tools/deals.js";
import { dqlOntologyTool } from "./tools/dql-ontology.js";
import { dqlProbeTool } from "./tools/dql-probe.js";
import { dqlTool } from "./tools/dql.js";
import { extractTool } from "./tools/extract.js";
import { newsTool } from "./tools/news.js";
import { organizationsTool } from "./tools/organizations.js";
import { peopleTool } from "./tools/people.js";
import { placesTool } from "./tools/places.js";
import { resolveEntitiesTool } from "./tools/resolve-entities.js";
import { searchWebTool } from "./tools/search-web.js";

export default defineToolPlugin({
  id: "diffbot",
  name: "Diffbot",
  description:
    "Structured web knowledge for OpenClaw agents: query Diffbot's Knowledge Graph (organizations, people, news, places, deals, and any other entity type via DQL), search the web with ranked and cited results, extract any URL into markdown or JSON, resolve named entities in text, and crawl whole sites.",
  configSchema,
  tools: (tool) => [
    // Web
    tool(searchWebTool),
    tool(extractTool),
    tool(crawlTool),
    tool(resolveEntitiesTool),
    // Knowledge Graph
    tool(dqlTool),
    tool(dqlProbeTool),
    tool(dqlOntologyTool),
    // Knowledge Graph, typed
    tool(newsTool),
    tool(organizationsTool),
    tool(peopleTool),
    tool(placesTool),
    tool(dealsTool),
  ],
});
