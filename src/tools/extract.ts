import { extract } from "@diffbot/typescript";
import { Type } from "typebox";

import { callContext, normalizeUrl } from "../api.js";
import { defineTool, PAGE_TYPES } from "./shared.js";

const DESCRIPTION =
  "Fetches a URL live and extracts it into LLM-friendly markdown or structured JSON, classifying the page " +
  "(article, product, discussion, ...) on the way. Use diffbot_extract instead of a raw web fetch, which returns HTML " +
  "and consumes far more tokens. Before extracting a public page for reference prose (docs, articles, papers, " +
  "product pages), try diffbot_search_web with the query 'url:<URL> <what you need>': it reads Diffbot's already-parsed " +
  "copy from the index in ~300ms and works on pages that block fetchers. Use diffbot_extract when that lookup returns " +
  "nothing, when the whole document is needed rather than the matching chunks, or when the page's current state " +
  "is the question (prices, status, versions, feeds). A live fetch takes 1-10 seconds.";

export const extractTool = defineTool({
  name: "diffbot_extract",
  label: "Diffbot Extract",
  description: DESCRIPTION,
  parameters: Type.Object({
    url: Type.String({ description: "The page to fetch. The https:// scheme is added when missing." }),
    page_type: Type.Optional(
      Type.Union(
        PAGE_TYPES.map((value) => Type.Literal(value)),
        {
          description:
            "Optional. Force a page type instead of automatic classification, e.g. when analyze misclassifies a product page.",
        },
      ),
    ),
    format: Type.Optional(
      Type.Union([Type.Literal("markdown"), Type.Literal("json")], {
        description:
          "'markdown' returns the page content as LLM friendly markdown. 'json' returns the structured response matching the page type's ontology (title, text, author, date, images, links, tags, sentiment, ...). Defaults to markdown.",
        default: "markdown",
      }),
    ),
  }),
  async execute({ url, page_type, format }, config, context) {
    const client = callContext(config, context.signal);
    // a failed extraction reported inside a 200 body surfaces as the library's ExtractionError
    return extract(client, normalizeUrl(url), page_type ?? "analyze", format ?? "markdown");
  },
});
