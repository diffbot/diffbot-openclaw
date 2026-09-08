import { entities } from "@diffbot/typescript";
import { Type } from "typebox";

import { callContext, isRecord } from "../api.js";
import { defineTool } from "./shared.js";

const DESCRIPTION =
  "Identifies the named entities (people, organizations, places, products) mentioned in a block of text and " +
  "resolves each one to a Diffbot Knowledge Graph entity, with confidence (is this the right record?), salience " +
  "(how central is it to the text?), and sentiment scores. Use for named entity recognition, to find which " +
  "companies or people a document is actually about, or to turn unstructured text into canonical entity ids. " +
  "The response includes dql_filter, an id:or(...) clause that can be pasted straight into diffbot_dql, e.g. " +
  "'type:Organization id:or(...)', to fetch the full records; id lookups bypass full-text search and are much " +
  "faster than matching by name. Entities without an id were recognized but not matched to a KG record.";

export function entityId(entity: Record<string, unknown>): string | null {
  const uri = typeof entity.id === "string" ? entity.id : typeof entity.diffbotUri === "string" ? entity.diffbotUri : "";
  const last = uri.replace(/\/+$/, "").split("/").pop() ?? "";
  return last || null;
}

export type ResolvedEntity = {
  name: unknown;
  types: string[];
  confidence: unknown;
  salience: unknown;
  sentiment: unknown;
  id: string | null;
  mentions: number;
};

export function shapeEntities(data: Record<string, unknown>): { sentiment: unknown; entities: ResolvedEntity[]; dql_filter: string | null } {
  const entities: ResolvedEntity[] = [];
  const raw = Array.isArray(data.entities) ? data.entities : [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const allTypes = Array.isArray(item.allTypes) ? item.allTypes : [];
    entities.push({
      name: item.name,
      types: allTypes.map((t) => (isRecord(t) && typeof t.name === "string" ? t.name : "")).filter(Boolean),
      confidence: item.confidence,
      salience: item.salience,
      sentiment: item.sentiment,
      id: entityId(item),
      mentions: Array.isArray(item.mentions) ? item.mentions.length : 0,
    });
  }
  const ids = entities.map((e) => e.id).filter((id): id is string => Boolean(id));
  return {
    sentiment: data.sentiment,
    entities,
    dql_filter: ids.length > 0 ? `id:or(${ids.map((id) => `"${id}"`).join(",")})` : null,
  };
}

export const resolveEntitiesTool = defineTool({
  name: "diffbot_resolve_entities",
  label: "Diffbot Resolve Entities",
  description: DESCRIPTION,
  parameters: Type.Object({
    text: Type.String({ description: "The text to analyze. Plain text, not HTML or markdown." }),
    lang: Type.Optional(
      Type.String({
        description:
          "Optional. Language code of the text (e.g. 'en', 'es', 'fr'). Defaults to auto-detection. Set explicitly for better accuracy on non-English text.",
      }),
    ),
  }),
  async execute({ text, lang }, config, context) {
    const client = callContext(config, context.signal);
    // the library already unwraps the one-result-per-document list
    const data = await entities(client, text, lang ?? "auto");
    return shapeEntities(isRecord(data) ? data : {});
  },
});
