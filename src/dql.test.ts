import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient, type CallContext } from "./api.js";
import {
  cleanRow,
  cleanValue,
  defaultFields,
  enumValues,
  findNamed,
  getOntology,
  ontologyFields,
  parseCsv,
  probe,
  resetOntologyCache,
  resolveValue,
  run,
  taxonomyValues,
} from "./dql.js";

const ctx: CallContext = createClient({ apiToken: "t", timeoutSeconds: 1 });

type Handler = (url: URL) => Response | Promise<Response>;

function stubFetch(handler: Handler) {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo) => {
      const url = input instanceof URL ? input : new URL(String(input));
      calls.push(url);
      return handler(url);
    }),
  );
  return calls;
}

const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 });

beforeEach(() => {
  resetOntologyCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseCsv", () => {
  it("handles quoted fields, embedded commas, doubled quotes, and CRLF", () => {
    const text = 'Name,Note\r\n"Acme, Inc.","said ""hi"""\r\nPlain,\r\n';
    expect(parseCsv(text)).toEqual([
      { Name: "Acme, Inc.", Note: 'said "hi"' },
      { Name: "Plain", Note: "" },
    ]);
  });

  it("returns nothing for an empty export", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("Name,Note\n")).toEqual([]);
  });
});

describe("post-processing", () => {
  it("strips the date prefix and expands scientific notation", () => {
    expect(cleanValue("d2026-07-23")).toBe("2026-07-23");
    expect(cleanValue("3.0E8")).toBe("300000000");
    expect(cleanValue("1.5E-1")).toBe("0.15");
    expect(cleanValue("Series A")).toBe("Series A");
  });

  it("drops empty columns", () => {
    expect(cleanRow({ Name: "X", Amount: "", Date: "d2026-01-01" })).toEqual({ Name: "X", Date: "2026-01-01" });
  });

  it("picks default columns by entity type", () => {
    expect(defaultFields('type:Investment investee.name:"OpenAI"')).toMatch(/^investee\.name,Company/);
    expect(defaultFields("type:City location.country.name:\"Japan\"")).toMatch(/^name,Place/);
    expect(defaultFields("type:Patent")).toMatch(/^id,Id/);
  });
});

describe("run", () => {
  it("returns a count only when hitsOnly is set", async () => {
    stubFetch(() => json({ hits: 42 }));
    await expect(run(ctx, "type:Organization", { hitsOnly: true })).resolves.toEqual({ dql: "type:Organization", hits: 42 });
  });

  it("reads csv rows with the default export spec alongside the count", async () => {
    const calls = stubFetch((url) => {
      if (url.searchParams.get("format") === "csv") {
        return new Response("Company,Employees\nDiffbot,3.0E1\n", { status: 200 });
      }
      return json({ hits: 1 });
    });
    const result = await run(ctx, 'type:Organization name:"Diffbot"', { size: 5 });
    expect(result).toEqual({
      dql: 'type:Organization name:"Diffbot"',
      hits: 1,
      offset: 0,
      returned: 1,
      results: [{ Company: "Diffbot", Employees: "30" }],
    });
    const csvCall = calls.find((url) => url.searchParams.get("format") === "csv");
    expect(csvCall?.searchParams.get("exportspec")).toMatch(/^name,Company/);
    expect(csvCall?.searchParams.get("size")).toBe("5");
  });

  it("reads facet buckets from the json response", async () => {
    stubFetch(() => json({ hits: 9, data: [{ value: "Reuters", count: 5, callbackQuery: "q" }] }));
    await expect(run(ctx, 'type:Article tags.label:"X" facet:siteName', { size: 3 })).resolves.toEqual({
      dql: 'type:Article tags.label:"X" facet:siteName',
      hits: 9,
      facet: true,
      results: [{ value: "Reuters", count: 5, query: "q" }],
    });
  });

  it("skips the count for similarTo and explains why", async () => {
    const calls = stubFetch(() => new Response("Company\nA\n", { status: 200 }));
    const result = await run(ctx, 'type:Organization similarTo(name:"OpenAI")', { size: 1 });
    expect(result.hits).toBeNull();
    expect(result.notes?.[0]).toMatch(/similarTo returns a ranked list/);
    expect(calls).toHaveLength(1);
  });

  it("flags a hit count equal to the bare type count", async () => {
    stubFetch((url) => {
      if (url.searchParams.get("format") === "csv") {
        return new Response("Company\nA\n", { status: 200 });
      }
      return json({ hits: 100 });
    });
    const result = await run(ctx, "type:Organization bogus:\"x\"", { bareTypeCheck: true });
    expect(result.notes?.[0]).toMatch(/filter path was probably ignored/);
  });

  it("unwraps entity records in json format and forwards the offset", async () => {
    const calls = stubFetch((url) => {
      if (url.searchParams.get("size") === "0") {
        return json({ hits: 2 });
      }
      return json({ data: [{ entity: { name: "A" } }, { name: "B" }] });
    });
    const result = await run(ctx, "type:Organization", { format: "json", size: 2, offset: 10 });
    expect(result.results).toEqual([{ name: "A" }, { name: "B" }]);
    expect(calls.some((url) => url.searchParams.get("from") === "10")).toBe(true);
  });
});

describe("probe", () => {
  it("counts each query, refuses similarTo, and reports errors without failing the batch", async () => {
    stubFetch((url) => {
      if (url.searchParams.get("query")?.includes("bad")) {
        return new Response("nope", { status: 500 });
      }
      return json({ hits: 7 });
    });
    const results = await probe(ctx, ["type:Organization", "type:Organization similarTo(name:\"X\")", "type:bad"]);
    expect(results[0]).toEqual({ query: "type:Organization", hits: 7 });
    expect(results[1].hits).toBeNull();
    expect(results[1].error).toMatch(/similarTo cannot be probed/);
    expect(results[2].hits).toBeNull();
    expect(results[2].error).toMatch(/Diffbot API error 500/);
  });
});

const ONTOLOGY = {
  types: {
    Organization: {
      fields: {
        name: { type: "String" },
        location: { type: "Location", isComposite: true },
        ceo: { type: "LinkedEntity", leType: ["Person"] },
        oldField: { type: "String", isDeprecated: true },
      },
    },
  },
  composites: { Location: { fields: { city: { type: "LinkedEntity", leType: ["Place"] } } } },
  enums: { Gender: { values: ["Male", "Female"] } },
  taxonomies: {
    OrganizationCategory: {
      categories: [
        { name: "Technology Companies", children: [{ name: "Semiconductor Companies" }, { name: "Software Companies" }] },
      ],
    },
  },
};

describe("ontology", () => {
  it("downloads once and serves from cache", async () => {
    const calls = stubFetch(() => json(ONTOLOGY));
    await getOntology(ctx);
    await getOntology(ctx);
    expect(calls).toHaveLength(1);
  });

  it("lists fields without deprecated ones and names linked types", async () => {
    stubFetch(() => json(ONTOLOGY));
    const ontology = await getOntology(ctx);
    expect(ontologyFields(ontology, "Organization")).toEqual([
      { field: "name", type: "String" },
      { field: "location", type: "Location", flags: ["isComposite"] },
      { field: "ceo", type: "LinkedEntity (Person)" },
    ]);
    expect(ontologyFields(ontology, "Location", /city/)).toHaveLength(1);
    expect(() => ontologyFields(ontology, "Nope")).toThrow(/not a known entity type/);
  });

  it("walks taxonomies, enums, and free-text search", async () => {
    stubFetch(() => json(ONTOLOGY));
    const ontology = await getOntology(ctx);
    expect(taxonomyValues(ontology, "OrganizationCategory")).toEqual(["Technology Companies", "Semiconductor Companies", "Software Companies"]);
    expect(taxonomyValues(ontology, "OrganizationCategory", /semi/i)).toEqual(["Semiconductor Companies"]);
    expect(enumValues(ontology, "Gender")).toEqual(["Male", "Female"]);
    expect(findNamed(ontology, /software/i)).toEqual(["Software Companies"]);
  });

  it("resolves free text exactly, case-insensitively, by unique substring, or returns candidates", async () => {
    stubFetch(() => json(ONTOLOGY));
    expect(await resolveValue(ctx, "OrganizationCategory", "Semiconductor Companies")).toEqual({ value: "Semiconductor Companies", candidates: [] });
    expect((await resolveValue(ctx, "OrganizationCategory", "semiconductor companies")).value).toBe("Semiconductor Companies");
    expect((await resolveValue(ctx, "OrganizationCategory", "software")).value).toBe("Software Companies");
    const ambiguous = await resolveValue(ctx, "OrganizationCategory", "companies");
    expect(ambiguous.value).toBeUndefined();
    expect(ambiguous.candidates).toHaveLength(3);
    const missing = await resolveValue(ctx, "OrganizationCategory", "banana");
    expect(missing.candidates).toEqual([]);
    expect(missing.note).toMatch(/diffbot_dql_ontology/);
    expect((await resolveValue(ctx, "Gender", "female", "enum")).value).toBe("Female");
  });
});
