/** Builder-primitive and executor post-processing assertions. No network: everything here is pure. */
import { describe, expect, it } from "vitest";

import { DiffbotToolError } from "./api.js";
import * as b from "./dql-builder.js";
import { cleanRow, cleanValue, defaultFields } from "./dql.js";

describe("builder primitives", () => {
  it("quote escapes double quotes", () => {
    expect(b.quote('Say "hi"')).toBe('"Say \\"hi\\""');
  });

  it("orClause collapses a single value and dedupes", () => {
    expect(b.orClause("tags.label", ["Nvidia"])).toBe('tags.label:"Nvidia"');
    expect(b.orClause("tags.label", ["Tesla", "Rivian", "Tesla"])).toBe('tags.label:or("Tesla","Rivian")');
    expect(b.orClause("name", ["A", "B"], true)).toBe('strict:name:or("A","B")');
  });

  it("subquery is empty without clauses", () => {
    expect(b.subquery("employments", [])).toBe("");
    expect(b.subquery("employments", ['employer.name:"Diffbot"', "isCurrent:true"])).toBe(
      'employments.{employer.name:"Diffbot" isCurrent:true}',
    );
  });

  it("expandTitles covers both spellings and board seats", () => {
    expect(b.expandTitles(["CEO"])).toEqual(["Chief Executive Officer", "CEO"]);
    expect(b.expandTitles(["chief technology officer"])).toEqual(["Chief Technology Officer", "CTO"]);
    expect(b.expandTitles(["board member"])).toEqual(["Board Member", "Board of Directors", "Director"]);
    expect(b.expandTitles(["VP of Engineering"])).toEqual(["VP of Engineering"]);
  });

  it("nameVariants folds diacritics", () => {
    expect(b.nameVariants("Kópavogur")).toEqual(["Kópavogur", "Kopavogur"]);
    expect(b.nameVariants("Reykjavik")).toEqual(["Reykjavik"]);
  });

  it("validates dates", () => {
    expect(b.dateRange("date", "2026-08-01", undefined)).toEqual(['date>="2026-08-01"']);
    expect(() => b.validateDate("August 2026", "since")).toThrow(DiffbotToolError);
  });

  it("validates the near radius", () => {
    expect(b.nearClause("Austin", "30mi")).toBe('near(type:Place name:"Austin", 30mi)');
    expect(b.nearClause("Paris")).toBe('near(type:Place name:"Paris")');
    expect(() => b.nearClause("Austin", "30 miles")).toThrow(DiffbotToolError);
  });
});

describe("executor post-processing", () => {
  it("cleanValue strips the date prefix and expands scientific notation", () => {
    expect(cleanValue("d2026-07-23")).toBe("2026-07-23");
    expect(cleanValue("d2026-08-12T20:02:31")).toBe("2026-08-12T20:02:31");
    expect(cleanValue("3.0E8")).toBe("300000000");
    expect(cleanValue("1.5E-1")).toBe("0.15");
    expect(cleanValue("Series A")).toBe("Series A");
  });

  it("cleanRow drops empty columns", () => {
    expect(cleanRow({ Name: "X", Amount: "", Date: "d2026-01-01" })).toEqual({ Name: "X", Date: "2026-01-01" });
  });

  it("defaultFields by type", () => {
    expect(defaultFields('type:Investment investee.name:"OpenAI"').startsWith("investee.name,Company")).toBe(true);
    expect(defaultFields('type:City location.country.name:"Japan"').startsWith("name,Place")).toBe(true);
    expect(defaultFields("type:Patent").startsWith("id,Id")).toBe(true);
  });
});
