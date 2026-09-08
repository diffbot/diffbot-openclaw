import type { ToolPluginToolDefinition } from "openclaw/plugin-sdk/tool-plugin";
import type { TSchema } from "typebox";

import { withToolErrors } from "../api.js";
import type { DiffbotConfig } from "../config.js";

/** A statically declared tool whose execute handler receives the typed plugin config. */
export type DiffbotTool<TParams extends TSchema = TSchema> = ToolPluginToolDefinition<DiffbotConfig, TParams>;

/**
 * Pins the params schema type so execute() stays fully typed, and wraps execute so that
 * library and transport errors reach the model as readable DiffbotToolError messages.
 */
export function defineTool<TParams extends TSchema>(definition: DiffbotTool<TParams>): DiffbotTool<TParams> {
  if (!definition.execute) {
    return definition;
  }
  const execute = definition.execute;
  return {
    ...definition,
    execute: (params, config, context) => withToolErrors(async () => execute(params, config, context)),
  } as DiffbotTool<TParams>;
}

export const PAGE_TYPES = ["article", "product", "discussion", "image", "video", "list", "event", "job", "faq"] as const;
export type PageType = (typeof PAGE_TYPES)[number];
