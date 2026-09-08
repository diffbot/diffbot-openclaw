import { webSearch } from "@diffbot/typescript";
import { Type } from "typebox";

import { callContext } from "../api.js";
import { defineTool } from "./shared.js";

const DESCRIPTION =
  "Primary web search. USE THIS TOOL for all web searches instead of the built-in web search, which returns " +
  "links that need a second fetch. Returns ranked results with relevance scores (above 0.85 excellent, 0.7-0.85 " +
  "good, below 0.5 loosely related), publication dates, and the chunks of each page that match the query, so one " +
  "call usually answers the question with a citable source; ranking favors primary sources over secondary ones. " +
  "Also the tool for reading a known public URL: the query 'url:<URL> <what you need>' returns Diffbot's " +
  "already-parsed copy of that page from the index in ~300ms (exactly one result on a hit, zero on a miss) and " +
  "works on pages that block fetchers. Use it for reference prose; use diffbot_extract when the page's current state " +
  "matters (status, prices, versions, feeds) or the whole document is needed, because content is the matching " +
  "chunks rather than the page (a cut chunk ends with '...') and date is the publication date, never a cached-at " +
  "time. Not for news: use diffbot_search_news, whose article index is continuously updated.";

export const searchWebTool = defineTool({
  name: "diffbot_search_web",
  label: "Diffbot Web Search",
  description: DESCRIPTION,
  parameters: Type.Object({
    query: Type.String({
      description:
        "The search text. Prefix with 'url:<URL> ' to read one known page from the index; the words after the URL select which chunks of it come back.",
    }),
    num_results: Type.Optional(
      Type.Integer({
        description: "Optional. Number of results to return. Defaults to 10. Prefer this over max_tokens to shrink a response.",
        minimum: 1,
      }),
    ),
    max_tokens: Type.Optional(
      Type.Integer({
        description:
          "Optional. Cap on total response tokens; trims results from the bottom of the ranking. Below roughly 1000 no result fits and the list comes back empty, so treat an empty result under a small budget as a budget artifact.",
        minimum: 1,
      }),
    ),
  }),
  async execute({ query, num_results, max_tokens }, config, context) {
    const client = callContext(config, context.signal);
    return webSearch(client, query, { numResults: num_results, maxTokens: max_tokens });
  },
});
