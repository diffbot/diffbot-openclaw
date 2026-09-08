import { Type } from "typebox";

import { callContext, DiffbotToolError } from "../api.js";
import { build, clause, compare, dateRange, orClause, subquery } from "../dql-builder.js";
import { DEFAULT_FIELDS, resolveValue, run } from "../dql.js";
import { defineTool } from "./shared.js";

const DESCRIPTION =
  "Searches news and articles in the Diffbot Knowledge Graph by mentioned company, person or product, topic, " +
  "publisher, language, date range, or sentiment, and returns dated, sourced, linkable results, newest first. " +
  "USE THIS for all news, including breaking and developing stories; the article index is continuously updated " +
  "and diffbot_search_web is the wrong tool for news. Rows are articles: coverage of an entity over time, sentiment " +
  "trends, who said what. mentions is the strongest lever (tags.label); if it returns nothing, retry the same " +
  "words as text. topic is looked up in the ArticleCategory taxonomy. Set facet for distribution questions such " +
  "as which outlets cover an entity. Returns the DQL it ran; refine with diffbot_dql when the shape is outside these " +
  "parameters.";

export type NewsSort = "newest" | "relevance" | "oldest";
export type NewsFacet = "siteName" | "categories.name" | "publisherCountry" | "date";

export type NewsQueryOptions = {
  mentions?: string[];
  topic?: string;
  text?: string;
  title?: string;
  publisher?: string;
  language?: string;
  publisher_country?: string;
  quoted_speaker?: string;
  since?: string;
  until?: string;
  sentiment_min?: number;
  sentiment_max?: number;
  mention_sentiment_max?: number;
  sort?: NewsSort;
  facet?: NewsFacet;
};

/** Return {dql, notes}. topic must already be an exact ArticleCategory value. */
export function buildNewsQuery(options: NewsQueryOptions = {}): { dql: string; notes: string[] } {
  const {
    mentions,
    topic,
    text,
    title,
    publisher,
    language,
    publisher_country,
    quoted_speaker,
    since,
    until,
    sentiment_min,
    sentiment_max,
    mention_sentiment_max,
    facet,
  } = options;
  let { sort } = options;
  const clauses = ["type:Article"];
  const notes: string[] = [];

  if (mentions && mentions.length > 0) {
    if (mention_sentiment_max !== undefined && mentions.length === 1) {
      // per-entity sentiment lives on the tag, so co-constrain label and score on one tag
      clauses.push(subquery("tags", [clause("label", mentions[0]), compare("sentiment", "<", mention_sentiment_max)]));
    } else {
      clauses.push(orClause("tags.label", mentions));
      if (mention_sentiment_max !== undefined) {
        notes.push(
          "mention_sentiment_max applies only with exactly one mention and was ignored; use sentiment_max for the document-level score.",
        );
      }
    }
  } else if (mention_sentiment_max !== undefined) {
    notes.push("mention_sentiment_max needs a mention and was ignored.");
  }

  if (topic) {
    clauses.push(clause("categories.name", topic));
  }
  if (text) {
    clauses.push(clause("text", text));
  }
  if (title) {
    clauses.push(clause("title", title));
  }
  if (publisher) {
    clauses.push(clause("siteName", publisher));
  }
  if (language) {
    clauses.push(clause("language", language));
  }
  if (publisher_country) {
    clauses.push(clause("publisherCountry", publisher_country));
  }
  if (quoted_speaker) {
    clauses.push(clause("quotes.speaker", quoted_speaker));
  }
  clauses.push(...dateRange("date", since, until));
  if (sentiment_min !== undefined) {
    clauses.push(compare("sentiment", ">=", sentiment_min));
  }
  if (sentiment_max !== undefined) {
    clauses.push(compare("sentiment", "<=", sentiment_max));
  }

  if (clauses.length === 1) {
    throw new DiffbotToolError(
      "diffbot_search_news needs at least one narrowing parameter (mentions, topic, text, title, publisher, quoted_speaker, or a date range); an unfiltered article query times out.",
    );
  }

  if (facet) {
    clauses.push(`facet:${facet}`);
    return { dql: build(clauses), notes };
  }

  // newest first is the default, unless a date window already scopes recency, in
  // which case relevance ordering picks the best articles inside it
  if (sort === undefined) {
    sort = since || until ? "relevance" : "newest";
  }
  if (sort === "newest") {
    clauses.push("sortBy:date");
  } else if (sort === "oldest") {
    clauses.push("revSortBy:date");
  }
  return { dql: build(clauses), notes };
}

export const newsTool = defineTool({
  name: "diffbot_search_news",
  label: "Diffbot News Search",
  description: DESCRIPTION,
  parameters: Type.Object({
    mentions: Type.Optional(
      Type.Array(Type.String(), { description: "Entities the article must mention (company, person, product, place), OR-ed." }),
    ),
    topic: Type.Optional(
      Type.String({
        description: "ArticleCategory value, e.g. 'Artificial Intelligence'. Free text is resolved; ambiguous text returns candidates.",
      }),
    ),
    text: Type.Optional(Type.String({ description: "Full-text phrase match on the body; the fallback when no tag or category fits." })),
    title: Type.Optional(Type.String({ description: "Headline-only phrase match; much tighter than text." })),
    publisher: Type.Optional(Type.String({ description: "Publisher site name, e.g. 'Reuters'." })),
    language: Type.Optional(Type.String({ description: "ISO language code, e.g. 'en'." })),
    publisher_country: Type.Optional(Type.String({ description: "Publisher's country, full name, e.g. 'Norway'." })),
    quoted_speaker: Type.Optional(Type.String({ description: "Articles quoting this person, e.g. 'Sam Altman'." })),
    since: Type.Optional(Type.String({ description: "Earliest publication date, YYYY-MM-DD." })),
    until: Type.Optional(Type.String({ description: "Latest publication date, YYYY-MM-DD." })),
    sentiment_min: Type.Optional(Type.Number({ description: "Minimum document sentiment, -1 to 1." })),
    sentiment_max: Type.Optional(Type.Number({ description: "Maximum document sentiment, -1 to 1; e.g. -0.5 for negative coverage." })),
    mention_sentiment_max: Type.Optional(
      Type.Number({
        description: "Maximum sentiment toward the single entity in mentions, for negative coverage of X specifically.",
      }),
    ),
    sort: Type.Optional(
      Type.Union([Type.Literal("newest"), Type.Literal("relevance"), Type.Literal("oldest")], {
        description: "Defaults to newest without a date range and relevance with one.",
      }),
    ),
    facet: Type.Optional(
      Type.Union(
        [Type.Literal("siteName"), Type.Literal("categories.name"), Type.Literal("publisherCountry"), Type.Literal("date")],
        { description: "Aggregate into buckets instead of rows; size becomes the bucket count." },
      ),
    ),
    size: Type.Optional(
      Type.Integer({ description: "Maximum number of articles (or buckets) to return.", minimum: 0, default: 10 }),
    ),
    offset: Type.Optional(Type.Integer({ description: "Number of articles to skip, for paging.", minimum: 0, default: 0 })),
  }),
  async execute(params, config, context) {
    const ctx = callContext(config, context.signal);
    const { mentions, size, offset } = params;
    let { topic, text } = params;
    const notes: string[] = [];
    if (topic) {
      const resolved = await resolveValue(ctx, "ArticleCategory", topic);
      if (resolved.value === undefined) {
        if (resolved.candidates.length > 0) {
          return { dql: null, candidates: { topic: resolved.candidates }, notes: [resolved.note ?? ""] };
        }
        notes.push(`${resolved.note ?? ""}; searched the article text for '${topic}' instead.`);
        text = text ? `${text} ${topic}`.trim() : topic;
        topic = undefined;
      } else {
        topic = resolved.value;
        if (resolved.note) {
          notes.push(resolved.note);
        }
      }
    }

    const { dql: query, notes: buildNotes } = buildNewsQuery({ ...params, topic, text });
    notes.push(...buildNotes);

    const result = await run(ctx, query, { size: size ?? 10, offset: offset ?? 0, fields: DEFAULT_FIELDS.Article });
    if (result.hits === 0 && mentions && mentions.length > 0 && !text) {
      notes.push("No article carries that tag. Tag values are entity names that may not match; retry with the same words in text.");
    }
    if (notes.length > 0) {
      result.notes = [...(result.notes ?? []), ...notes];
    }
    return result;
  },
});
