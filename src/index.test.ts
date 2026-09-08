import { describe, expect, it } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import entry from "./index.js";

const EXPECTED_TOOLS = [
  "diffbot_search_web",
  "diffbot_extract",
  "diffbot_crawl",
  "diffbot_resolve_entities",
  "diffbot_dql",
  "diffbot_dql_probe",
  "diffbot_dql_ontology",
  "diffbot_search_news",
  "diffbot_search_organizations",
  "diffbot_search_people",
  "diffbot_search_places",
  "diffbot_search_deals",
];

describe("diffbot plugin", () => {
  const metadata = getToolPluginMetadata(entry);

  it("declares the plugin id and every tool", () => {
    expect(metadata?.id).toBe("diffbot");
    expect(metadata?.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
  });

  it("exposes an optional apiToken and timeout in the config schema", () => {
    const properties = (metadata?.configSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(properties).sort()).toEqual(["apiToken", "timeoutSeconds"]);
    expect((metadata?.configSchema as { required?: string[] }).required ?? []).toEqual([]);
  });

  it("gives every tool a description and an object parameter schema", () => {
    for (const tool of metadata?.tools ?? []) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.parameters.type).toBe("object");
    }
  });
});
