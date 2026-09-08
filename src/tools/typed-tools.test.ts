/** Generated-DQL assertions for the typed tools. No network: the builders are pure. */
import { describe, expect, it } from "vitest";

import { DiffbotToolError } from "../api.js";
import { buildDealsQuery } from "./deals.js";
import { buildNewsQuery } from "./news.js";
import { buildOrganizationsQuery } from "./organizations.js";
import { buildLeadershipQuery, buildPeopleQuery, pickEmployment } from "./people.js";
import { buildPlacesQuery } from "./places.js";

describe("news", () => {
  it("defaults to newest without a date and relevance with one", () => {
    expect(buildNewsQuery({ mentions: ["OpenAI"] }).dql).toBe('type:Article tags.label:"OpenAI" sortBy:date');
    expect(buildNewsQuery({ mentions: ["OpenAI"], since: "2026-08-01" }).dql).toBe(
      'type:Article tags.label:"OpenAI" date>="2026-08-01"',
    );
    expect(buildNewsQuery({ mentions: ["OpenAI"], sort: "oldest" }).dql.endsWith("revSortBy:date")).toBe(true);
  });

  it("co-constrains entity sentiment on the tag", () => {
    expect(buildNewsQuery({ mentions: ["Nvidia"], mention_sentiment_max: -0.3 }).dql).toBe(
      'type:Article tags.{label:"Nvidia" sentiment<-0.3} sortBy:date',
    );
  });

  it("facet has no sort", () => {
    expect(buildNewsQuery({ mentions: ["Anthropic"], facet: "siteName" }).dql).toBe(
      'type:Article tags.label:"Anthropic" facet:siteName',
    );
  });

  it("refuses an unfiltered query", () => {
    expect(() => buildNewsQuery()).toThrow(DiffbotToolError);
  });
});

describe("organizations", () => {
  it("strict name and hq location", () => {
    expect(buildOrganizationsQuery({ industry: ["Semiconductor Companies"], country: "United States", is_public: true })).toBe(
      'type:Organization categories.name:"Semiconductor Companies" location.country.name:"United States" isPublic:true',
    );
    expect(buildOrganizationsQuery({ name: "Apple Inc." })).toBe('type:Organization strict:name:"Apple Inc."');
    expect(buildOrganizationsQuery({ city: "Berlin", any_office: true })).toBe('type:Organization locations.city.name:"Berlin"');
  });

  it("acquired_by and similar_to", () => {
    expect(buildOrganizationsQuery({ acquired_by: "Microsoft" })).toBe(
      'type:Organization isAcquired:true acquiredBy.name:"Microsoft"',
    );
    expect(buildOrganizationsQuery({ similar_to: "OpenAI", country: "United States" })).toBe(
      'type:Organization similarTo(name:"OpenAI") location.country.name:"United States"',
    );
    expect(buildOrganizationsQuery({ similar_to: "walmart.com" })).toBe('type:Organization similarTo(homepageUri:"walmart.com")');
  });

  it("sort is opt-in", () => {
    expect(buildOrganizationsQuery({ industry: ["Semiconductor Companies"] })).not.toContain("SortBy");
    expect(buildOrganizationsQuery({ industry: ["Semiconductor Companies"], sort: "employees" }).endsWith("revSortBy:nbEmployees")).toBe(
      true,
    );
  });
});

describe("people", () => {
  it("employment conditions share one subquery with expanded titles", () => {
    expect(buildPeopleQuery({ title: ["Chief Executive Officer"], employer_industry: "Semiconductor Companies" })).toBe(
      'type:Person employments.{title:or("Chief Executive Officer","CEO") employer.categories.name:"Semiconductor Companies" isCurrent:true}',
    );
  });

  it("history drops isCurrent and education is co-constrained", () => {
    expect(buildPeopleQuery({ employer: "Nvidia", current: false, school: "Stanford University", major: "Computer Science" })).toBe(
      'type:Person employments.{employer.name:"Nvidia"} educations.{institution.name:"Stanford University" major.name:"Computer Science"}',
    );
  });

  it("leadership query prefers the domain and requests curated fields", () => {
    expect(buildLeadershipQuery("tesla.com")).toBe('type:Organization homepageUri:"tesla.com" get:name,ceo,founders');
    expect(buildLeadershipQuery("Tesla")).toBe('type:Organization name:"Tesla" get:name,ceo,founders');
  });

  it("pickEmployment returns the matched job not the primary one", () => {
    const employments = [
      { title: "CEO", employer: { name: "Neuralink" }, isCurrent: true },
      { title: "Co-Founder", employer: { name: "Tesla" }, isCurrent: false },
    ];
    expect((pickEmployment(employments, "Tesla", [], false).employer as { name: string }).name).toBe("Tesla");
    expect((pickEmployment(employments, undefined, ["CEO"], true).employer as { name: string }).name).toBe("Neuralink");
  });
});

describe("places", () => {
  it("uses the narrow type and both spellings", () => {
    expect(buildPlacesQuery({ kind: "city", name: "Kópavogur" }).dql).toBe('type:City strict:name:or("Kópavogur","Kopavogur")');
    expect(buildPlacesQuery({ kind: "city", country: "Japan", min_population: 1000000, sort: "population" }).dql).toBe(
      'type:City location.country.name:"Japan" population>=1000000 revSortBy:population',
    );
  });

  it("poi and continent note", () => {
    expect(buildPlacesQuery({ kind: "poi", descriptors: "national park", near: "Yosemite", radius: "20mi" }).dql).toBe(
      'type:Place not(types:"AdministrativeArea") descriptors:"national park" near(type:Place name:"Yosemite", 20mi)',
    );
    const { dql, notes } = buildPlacesQuery({ kind: "country", continent: "Europe" });
    expect(dql).toBe('type:Country description:"in Europe"');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toContain("text-matched");
  });
});

describe("deals", () => {
  it("funding rounds", () => {
    const { dql, fields, mode } = buildDealsQuery({ kind: "funding", investor: "Sequoia Capital", sort: "newest" });
    expect(dql).toBe('type:Investment investment.investors.name:"Sequoia Capital" revSortBy:investment.date');
    expect(mode).toBe("rows");
    expect(fields?.startsWith("investee.name,Company")).toBe(true);
    expect(buildDealsQuery({ kind: "funding", series: "Series A", since: "2026-01-01", sort: "largest" }).dql).toBe(
      'type:Investment investment.series:"Series A" investment.date>="2026-01-01" revSortBy:investment.amount.value',
    );
    expect(buildDealsQuery({ kind: "funding", min_amount: 100000000 }).dql).toBe(
      'type:Investment investment.amount.value>=100000000 investment.amount.currency:"USD"',
    );
  });

  it("acquisitions route through the target organization", () => {
    const { dql, fields } = buildDealsQuery({ kind: "acquisitions", acquirer: "Microsoft", sort: "largest" });
    expect(dql).toBe('type:Organization isAcquired:true acquiredBy.name:"Microsoft" revSortBy:acquiredBy.amount.value');
    expect(fields?.startsWith("name,Target")).toBe(true);
  });

  it("industry moves to the company side with a subquery", () => {
    const { dql, fields, mode } = buildDealsQuery({
      kind: "funding",
      industry: "Artificial Intelligence Software",
      min_amount: 50000000,
      since: "2026-01-01",
    });
    expect(dql).toBe(
      'type:Organization categories.name:"Artificial Intelligence Software" investments.{amount.value>=50000000 amount.currency:"USD" date>="2026-01-01"}',
    );
    expect(mode).toBe("industry");
    expect(fields).toBeUndefined();
  });

  it("facets and invalid combinations", () => {
    expect(buildDealsQuery({ kind: "funding", since: "2026-01-01", facet: "series" }).dql).toBe(
      'type:Investment investment.date>="2026-01-01" facet:investment.series',
    );
    expect(() => buildDealsQuery({ kind: "acquisitions", series: "Series A" })).toThrow(DiffbotToolError);
    expect(() => buildDealsQuery({ kind: "funding" })).toThrow(DiffbotToolError);
  });
});
