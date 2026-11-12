import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OUTCOME,
  VERDICT,
  assessAnalysis,
  classifySources,
  criticismSearched,
  ownerTokens,
  citeItems,
  extractSourcesWithMap,
  normalizeAnalysis,
  decideOutcome,
  extractSources,
  parseModelJson,
  shapeResponse,
  validateAnalysis,
  validateInput,
  viewFor,
} from "../src/lib/analysis.js";
import { CAP_MAX, CAP_WINDOW_MS, recordGeneration, remainingGenerations } from "../src/lib/dailyCap.js";
import handler from "../api/generate.js";
import { SYSTEM_PROMPT } from "../src/lib/prompt.js";

// ---------------------------------------------------------------- fixtures

const INPUT = { brand: "Dove", campaign: "Campaign for Real Beauty", year: 2004, detail: "" };

function fullAnalysis(overrides = {}) {
  return {
    isBeauty: true,
    campaignFound: true,
    ambiguous: false,
    candidates: [],
    message: "",
    matchedCampaign: { brand: "Dove", name: "Campaign for Real Beauty", year: 2004 },
    parentCompany: "Unilever",
    context: "Dove faced a commoditised soap market.",
    brandContext: [],
    objective: "Reposition Dove around self-esteem.",
    whatTheyDid: { idea: "Real women, not models.", channels: ["Billboards", "Online film"], audience: "Women 25-54" },
    results: { available: true, items: [{ text: "Dove soap sales rose from $2bn to $4bn in three years.", type: "sales", dated: true, scopeStated: true }] },
    reception: { praise: ["Widely praised."], criticism: ["Accused of hypocrisy."], backlash: "" },
    verdict: {
      cultural: { rating: "Strong", note: "Widely discussed." },
      commercial: { rating: "Positive", note: "Sales doubled." },
      evidence: ["Long-running platform."],
      interpretation: "Built lasting equity.",
    },
    sourceTypes: [],
    lessons: ["Own a purpose.", "Stay consistent."],
    ...overrides,
  };
}

const empty = {
  candidates: [],
  matchedCampaign: null,
  parentCompany: "",
  context: "",
  brandContext: [],
  sourceTypes: [],
  objective: "",
  whatTheyDid: null,
  results: null,
  reception: null,
  verdict: null,
  lessons: [],
};

const SOURCES = (n) => Array.from({ length: n }, (_, i) => ({ title: `site${i}.com`, uri: `https://vertexaisearch.cloud.google.com/r/${i}` }));

// ---------------------------------------------------------------- JSON validation

test("a complete analysis validates", () => {
  assert.deepEqual(validateAnalysis(fullAnalysis()), []);
});

test("malformed analyses are rejected with reasons", () => {
  assert.deepEqual(validateAnalysis(null), ["response is not a JSON object"]);
  assert.ok(validateAnalysis({ ...fullAnalysis(), isBeauty: "yes" }).length > 0);
  assert.ok(validateAnalysis(fullAnalysis({ sourceTypes: [{ domain: "x.com", type: "independent" }] })).some((e) => e.includes("sourceTypes")));
  assert.ok(validateAnalysis(fullAnalysis({ lessons: ["only one"] })).some((e) => e.includes("lessons")));
  // Four lessons are accepted and ALL shown: grounded results
  // are never trimmed. More than 6 is malformed and not shown at all.
  const four = fullAnalysis({ lessons: ["a", "b", "c", "d"] });
  assert.deepEqual(validateAnalysis(four), []);
  assert.deepEqual(shapeResponse(four, INPUT, SOURCES(5)).lessons, ["a", "b", "c", "d"]);
  assert.ok(validateAnalysis(fullAnalysis({ lessons: ["1", "2", "3", "4", "5", "6", "7"] })).length > 0);
  const v = fullAnalysis().verdict;
  assert.ok(validateAnalysis(fullAnalysis({ verdict: { ...v, commercial: { rating: "Great", note: "x" } } })).length > 0);
  assert.ok(validateAnalysis(fullAnalysis({ results: { available: true, items: ["a bare string"] } })).length > 0);
  assert.ok(validateAnalysis(fullAnalysis({ results: { available: true, items: [{ text: "x", type: "vibes", dated: true, scopeStated: true }] } })).length > 0);
  // Results flag must agree with the items.
  assert.ok(validateAnalysis(fullAnalysis({ results: { available: true, items: [] } })).length > 0);
  assert.ok(validateAnalysis(fullAnalysis({ results: { available: false, items: fullAnalysis().results.items } })).length > 0);
});

test("normalize drops blank entries but never shortens a list", () => {
  const nine = Array.from({ length: 9 }, (_, i) => "Channel " + i);
  const raw = fullAnalysis({ whatTheyDid: { idea: "x", channels: ["", ...nine], audience: "y" } });
  assert.ok(validateAnalysis(raw).length > 0); // a blank entry: rejected as-is
  const fixed = normalizeAnalysis(raw);
  assert.deepEqual(validateAnalysis(fixed), []);
  assert.deepEqual(fixed.whatTheyDid.channels, nine); // all 9 real entries kept
  // Over the ceiling: rejected (not shown), never cut down.
  const many = Array.from({ length: 21 }, (_, i) => "C" + i);
  assert.ok(validateAnalysis(normalizeAnalysis(fullAnalysis({ whatTheyDid: { idea: "x", channels: many, audience: "y" } }))).length > 0);
  // Missing content still fails after normalizing.
  assert.ok(validateAnalysis(normalizeAnalysis(fullAnalysis({ whatTheyDid: { idea: "x", channels: [""], audience: "y" } }))).length > 0);
  assert.equal(raw.whatTheyDid.channels.length, 10); // input not mutated
  assert.equal(normalizeAnalysis(null), null);
});

test("'No public results found' is a valid answer", () => {
  assert.deepEqual(validateAnalysis(fullAnalysis({ results: { available: false, items: [] } })), []);
});

test("JSON is recovered from fenced or chatty replies, and garbage returns null", () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Here you go: {"a":1} hope that helps'), { a: 1 });
  assert.equal(parseModelJson("no json here"), null);
  assert.equal(parseModelJson('{"a":'), null);
});

// ---------------------------------------------------------------- beauty guardrail

test("non-beauty requests never carry analysis fields, whatever the model sent", () => {
  // The model wrongly filled in an analysis but flagged it non-beauty.
  const data = fullAnalysis({ isBeauty: false, message: "This tool only covers beauty campaigns." });
  assert.deepEqual(validateAnalysis(data), []);
  const shaped = shapeResponse(data, INPUT, SOURCES(6));
  assert.equal(shaped.outcome, OUTCOME.notBeauty);
  assert.deepEqual(Object.keys(shaped).sort(), ["campaignFound", "isBeauty", "message", "outcome"]);
});

test("the browser refuses to render an analysis unless isBeauty is true", () => {
  const good = shapeResponse(fullAnalysis(), INPUT, SOURCES(6));
  assert.equal(viewFor(good).view, OUTCOME.analysis);
  // Tampered / inconsistent responses: analysis outcome but isBeauty false or missing.
  assert.equal(viewFor({ ...good, isBeauty: false }).view, OUTCOME.notBeauty);
  assert.equal(viewFor({ ...good, isBeauty: undefined }).view, OUTCOME.notBeauty);
  assert.equal(viewFor({ ...good, campaignFound: false }).view, "error");
  assert.equal(viewFor({ ...good, sources: [] }).code, "no_sources");
  assert.equal(viewFor({ ...good, verdict: null }).code, "malformed");
  assert.equal(viewFor({ ...good, assessment: undefined }).code, "malformed");
  assert.equal(viewFor({ ...good, assessment: { ...good.assessment, verdict: "Triumph" } }).code, "malformed");
  assert.equal(viewFor(null).code, "malformed");
});

// ---------------------------------------------------------------- not found / ambiguous / mismatch

test("not found: no analysis is produced", () => {
  const data = { isBeauty: true, campaignFound: false, ambiguous: false, message: "Couldn't confirm this campaign.", ...empty };
  assert.deepEqual(validateAnalysis(data), []);
  const shaped = shapeResponse(data, INPUT, []);
  assert.equal(shaped.outcome, OUTCOME.notFound);
  assert.equal(shaped.verdict, undefined);
  assert.equal(viewFor(shaped).view, OUTCOME.notFound);
});

test("ambiguous: candidates required, no analysis", () => {
  const data = {
    isBeauty: true, campaignFound: true, ambiguous: true, message: "Several campaigns match.",
    ...empty, candidates: ["Glow Up", "Glow Up Holiday"],
  };
  assert.deepEqual(validateAnalysis(data), []);
  assert.ok(validateAnalysis({ ...data, candidates: ["only one"] }).length > 0);
  const shaped = shapeResponse(data, INPUT, SOURCES(3));
  assert.equal(shaped.outcome, OUTCOME.ambiguous);
  assert.deepEqual(shaped.candidates, ["Glow Up", "Glow Up Holiday"]);
  assert.equal(shaped.verdict, undefined);
  assert.equal(viewFor(shaped).view, OUTCOME.ambiguous);
});

test("brand or year that doesn't match the request is not analysed", () => {
  const wrongYear = fullAnalysis({ matchedCampaign: { brand: "Dove", name: "Real Beauty Sketches", year: 2013 } });
  assert.deepEqual(decideOutcome(wrongYear, INPUT), {
    outcome: OUTCOME.mismatch, found: { brand: "Dove", name: "Real Beauty Sketches", year: 2013 }, reason: "year",
  });
  const wrongBrand = fullAnalysis({ matchedCampaign: { brand: "Nike", name: "Just Do It", year: 2004 } });
  assert.equal(decideOutcome(wrongBrand, INPUT).reason, "brand");
  // Within a year, and brand written differently, is still a match.
  const close = fullAnalysis({ matchedCampaign: { brand: "Dove (Unilever)", name: "Real Beauty", year: 2005 } });
  assert.equal(decideOutcome(close, INPUT).outcome, OUTCOME.analysis);
});

// ---------------------------------------------------------------- confidence + sources

const site = (domain, i = 0) => ({ title: domain, uri: `https://vertexaisearch.cloud.google.com/r/${domain}/${i}` });
const PRESS = [site("adage.com"), site("campaignlive.co.uk"), site("marketingweek.com")];

test("source tags: brand or parent company in the domain is brand-owned, whatever the model says", () => {
  assert.ok(ownerTokens("L'Oréal Paris").includes("loreal"));
  assert.ok(ownerTokens("Olay", "Procter & Gamble").includes("pg"));
  const tagged = classifySources(
    [site("dove.com"), site("unilever.com"), site("lorealparisusa.com"), site("us.pg.com"), site("adage.com"), site("someblog.net"), site("wikipedia.org"), site("pgatour.com")],
    { brand: "Dove", parentCompany: "Unilever", sourceTypes: [{ domain: "dove.com", type: "trade_press" }, { domain: "someblog.net", type: "trade_press" }] }
  );
  assert.deepEqual(tagged.map((s) => s.type), ["brand_owned", "brand_owned", "blog_aggregator", "blog_aggregator", "trade_press", "trade_press", "blog_aggregator", "blog_aggregator"]);
  assert.equal(classifySources([site("lorealparisusa.com")], { brand: "L'Oréal Paris" })[0].type, "brand_owned");
  assert.equal(classifySources([site("us.pg.com")], { brand: "Olay", parentCompany: "Procter & Gamble" })[0].type, "brand_owned");
  // Real page URLs (the hand-written examples) use their own hostname.
  assert.equal(classifySources([{ title: "Wikipedia: Dove", uri: "https://en.wikipedia.org/wiki/Dove" }], { brand: "Dove" })[0].domain, "en.wikipedia.org");
});

test("confidence ignores source count: it needs non-brand sites AND a campaign-level outcome", () => {
  const base = fullAnalysis();
  // Twelve sources, all brand-owned: still Low.
  const owned = Array.from({ length: 12 }, (_, i) => site("dove.com", i));
  assert.equal(assessAnalysis(base, owned, {}, { brand: "Dove" }).confidence, "Low");
  // Same site counted once: three pages of adage.com is one site.
  const sameSite = [site("adage.com", 1), site("adage.com", 2), site("adage.com", 3)];
  assert.equal(assessAnalysis(base, sameSite, {}, { brand: "Dove" }).confidence, "Medium");
  // Outcome backed by one site only: uncorroborated, so Medium.
  assert.equal(assessAnalysis(base, PRESS, { results: [[0]] }, { brand: "Dove" }).confidence, "Medium");
  assert.equal(assessAnalysis(base, PRESS, {}, { brand: "Dove" }).confidence, "Medium");
  // Outcome backed by 2+ non-brand sites, 3 distinct sites overall: High.
  const high = assessAnalysis(base, PRESS, { results: [[0, 1]] }, { brand: "Dove" });
  assert.equal(high.confidence, "High");
  assert.equal(high.verdict, VERDICT.success);
  assert.ok(!/source count|returned \d+ sources/i.test(high.confidenceReason));
  // Outcome linked only to brand-owned sources: never High.
  const brandOnly = assessAnalysis(base, [site("dove.com"), ...PRESS], { results: [[0]] }, { brand: "Dove" });
  assert.equal(brandOnly.confidence, "Medium");
  assert.match(brandOnly.confidenceReason, /brand-owned/);
});

test("no campaign-level outcome: insufficient evidence, or cultural impact with commercial effect unproven", () => {
  const brandLevelOnly = fullAnalysis({
    results: { available: true, items: [{ text: "Dove's total revenue reached €6 billion.", type: "sales", dated: true, scopeStated: true }] },
    verdict: { ...fullAnalysis().verdict, cultural: { rating: "Weak", note: "Little coverage." }, commercial: { rating: "Positive", note: "Brand grew." } },
  });
  const a = assessAnalysis(brandLevelOnly, PRESS, {}, { brand: "Dove" });
  assert.equal(a.verdict, VERDICT.insufficient);
  assert.equal(a.confidence, "Medium");
  assert.ok(a.resultFlags[0].some((f) => f.startsWith("brand-level")));

  const undated = fullAnalysis({ results: { available: true, items: [{ text: "Sales rose 700%.", type: "sales", dated: false, scopeStated: false }] } });
  const u = assessAnalysis(undated, PRESS, {}, { brand: "Dove" });
  assert.equal(u.verdict, VERDICT.cultural);
  assert.deepEqual(u.resultFlags[0], ["scope unclear"]);

  const thin = fullAnalysis({ results: { available: false, items: [] } });
  const t = assessAnalysis(thin, [site("dove.com"), site("someblog.net")], {}, { brand: "Dove" });
  assert.equal(t.verdict, VERDICT.insufficient);
  assert.equal(t.confidence, "Low");
});

test("verdict and confidence read the same commercial-evidence rule, so they can't contradict", () => {
  // REN-style: outputs tagged as measured results, but the commercial rating is Unproven.
  const ren = fullAnalysis({
    results: { available: true, items: [
      { text: "Reached zero waste by early 2022.", type: "measured_result", dated: true, scopeStated: true },
      { text: "Repurposed 45 tonnes of plastic.", type: "output", dated: true, scopeStated: true },
    ] },
    verdict: { ...fullAnalysis().verdict, cultural: { rating: "Strong", note: "x" }, commercial: { rating: "Unproven", note: "y" } },
  });
  const a = assessAnalysis(ren, PRESS, { results: [[0, 1], [0, 1]] }, { brand: "Dove" });
  assert.equal(a.commercialEvidence.present, false);
  assert.equal(a.verdict, VERDICT.cultural);
  assert.equal(a.confidence, "Medium");
  assert.match(a.confidenceReason, /commercial rating: Unproven/);
  assert.match(a.verdictReason, /commercial rating: Unproven/);
  // Positive rating with no outcome item isn't evidence either.
  const noItems = fullAnalysis({ results: { available: false, items: [] } });
  const b = assessAnalysis(noItems, PRESS, {}, { brand: "Dove" });
  assert.equal(b.commercialEvidence.present, false);
  assert.notEqual(b.verdict, VERDICT.success);
  assert.notEqual(b.confidence, "High");
});

test("brand-owned if EITHER the domain check OR the model says so", () => {
  const tagged = classifySources([site("hul.co.in"), site("adage.com")], {
    brand: "Dove", parentCompany: "Unilever",
    sourceTypes: [{ domain: "hul.co.in", type: "brand_owned" }, { domain: "adage.com", type: "brand_owned" }],
  });
  assert.deepEqual(tagged.map((s) => s.type), ["brand_owned", "brand_owned"]);
});

test("High needs trade or business press among an outcome's sources; Wikipedia is aggregator tier", () => {
  const base = fullAnalysis();
  const blogs = [site("en.wikipedia.org"), site("someblog.net"), site("another-blog.com")];
  // The model calling Wikipedia trade press doesn't change its tier.
  const withModel = { ...base, sourceTypes: [{ domain: "en.wikipedia.org", type: "trade_press" }, { domain: "someblog.net", type: "trade_press" }] };
  const tagged = classifySources(blogs, { brand: "Dove", sourceTypes: withModel.sourceTypes });
  assert.equal(tagged[0].type, "blog_aggregator");
  assert.equal(tagged[0].typeBasis, "list");
  // Outcome backed by Wikipedia + a blog only: corroborated, but not press-backed, so Medium.
  const noPress = assessAnalysis(base, blogs, { results: [[0, 2]] }, { brand: "Dove" });
  assert.equal(noPress.commercialEvidence.corroborated, true);
  assert.equal(noPress.commercialEvidence.pressBacked, false);
  assert.equal(noPress.confidence, "Medium");
  assert.match(noPress.confidenceReason, /trade or business press/);
  // Same outcome also backed by adage.com: High.
  const withPress = assessAnalysis(base, [...blogs, site("adage.com")], { results: [[0, 3]] }, { brand: "Dove" });
  assert.equal(withPress.commercialEvidence.pressBacked, true);
  assert.equal(withPress.confidence, "High");
});

test("parent-company alias list: hul.co.in is Unilever-owned, but only for Unilever brands", () => {
  const sites = [site("hul.co.in"), site("elcompanies.com"), site("unilever.com")];
  assert.deepEqual(
    classifySources(sites, { brand: "Dove", parentCompany: "Unilever" }).map((s) => [s.type, s.typeBasis]),
    [["brand_owned", "alias"], ["blog_aggregator", "default"], ["brand_owned", "alias"]]
  );
  // A competitor's corporate site is not brand-owned for another company's brand.
  assert.equal(classifySources([site("unilever.com")], { brand: "L'Oréal Paris", parentCompany: "L'Oréal" })[0].type, "blog_aggregator");
  assert.equal(classifySources([site("elcompanies.com")], { brand: "Clinique", parentCompany: "The Estée Lauder Companies" })[0].type, "brand_owned");
  assert.equal(classifySources([site("pgcareers.com")], { brand: "Olay", parentCompany: "Procter & Gamble" })[0].type, "brand_owned");
  assert.equal(classifySources([site("lorealusa.com")], { brand: "L'Oréal Paris" })[0].type, "brand_owned"); // brand names the parent
  assert.equal(classifySources([site("kao.com")], { brand: "Bioré", parentCompany: "Kao Corporation" })[0].type, "brand_owned");
});

test("app notes for the Commercial effect card and the Interpretation whenever the app treats it as unproven", () => {
  // The live L'Oréal contradiction: the model says Positive, but no campaign-level result exists.
  const positiveNoResult = fullAnalysis({
    results: { available: true, items: [{ text: "Brand awareness stands at 87% in the U.S.", type: "reach", dated: false, scopeStated: true }] },
  });
  const a = assessAnalysis(positiveNoResult, PRESS, {}, { brand: "Dove" });
  assert.equal(a.commercialEvidence.present, false);
  assert.match(a.commercialNote, /^The model rated this "Positive" below, but the app treats the commercial effect as unproven/);
  assert.match(a.interpretationNote, /model's reading, not backed by a campaign-level result/);
  assert.notEqual(a.verdict, VERDICT.success);
  // Model already says Unproven: the note says so without "the model rated".
  const unproven = { ...positiveNoResult, verdict: { ...positiveNoResult.verdict, commercial: { rating: "Unproven", note: "n" } } };
  assert.match(assessAnalysis(unproven, PRESS, {}, { brand: "Dove" }).commercialNote, /^The app treats the commercial effect as unproven/);
  // Commercial evidence present: no note.
  const proven = assessAnalysis(fullAnalysis(), PRESS, { results: [[0, 1]] }, { brand: "Dove" });
  assert.equal(proven.commercialNote, null);
  assert.equal(proven.interpretationNote, null);
});

test("source tiers: academic/institutional and general news are separate, and only trade/business press reaches High", () => {
  const tagged = classifySources(
    [site("jhu.edu"), site("ox.ac.uk"), site("aljazeera.com"), site("laweekly.com"), site("adage.com"), site("madeometer.com")],
    { brand: "L'Oréal Paris", sourceTypes: [{ domain: "aljazeera.com", type: "trade_press" }, { domain: "madeometer.com", type: "blog_aggregator" }] }
  );
  assert.deepEqual(tagged.map((s) => s.type), ["academic", "academic", "news", "news", "trade_press", "blog_aggregator"]);
  // An outcome backed by news + academic sites only: corroborated, not press-backed, so Medium.
  const base = fullAnalysis();
  const nonTrade = [site("jhu.edu"), site("aljazeera.com"), site("laweekly.com")];
  const m = assessAnalysis(base, nonTrade, { results: [[0, 1, 2]] }, { brand: "Dove" });
  assert.equal(m.commercialEvidence.corroborated, true);
  assert.equal(m.commercialEvidence.pressBacked, false);
  assert.equal(m.confidence, "Medium");
  // Add one trade-press site backing it: High.
  assert.equal(assessAnalysis(base, [...nonTrade, site("adage.com")], { results: [[1, 3]] }, { brand: "Dove" }).confidence, "High");
  // The model can still classify unknown sites into the new tiers, and they validate.
  assert.deepEqual(validateAnalysis(fullAnalysis({ sourceTypes: [{ domain: "x.org", type: "academic" }, { domain: "y.com", type: "news" }] })), []);
});

test("a result backed only by brand-owned sources is tagged as the brand's own claim", () => {
  const data = fullAnalysis({
    results: { available: true, items: [
      { text: "Sales rose 20% in 2019.", type: "sales", dated: true, scopeStated: true },
      { text: "Sales rose 30% in 2020.", type: "sales", dated: true, scopeStated: true },
      { text: "Sales rose 40% in 2021.", type: "sales", dated: true, scopeStated: true },
    ] },
  });
  const sources = [site("dove.com"), site("unilever.com"), site("adage.com")];
  const a = assessAnalysis(data, sources, { results: [[0, 1], [0, 2], []] }, { brand: "Dove" });
  assert.ok(a.resultFlags[0].includes("brand's own claim"));
  assert.ok(!a.resultFlags[1].includes("brand's own claim")); // one non-brand source backs it
  assert.ok(!a.resultFlags[2].includes("brand's own claim")); // unlinked: can't tell
});

test("report places the commercial app note above the model's rating and leaves the rating unchanged", () => {
  const src = readFileSync(new URL("../src/components/Report.jsx", import.meta.url), "utf8");
  const note = src.indexOf("a.commercialNote &&");
  const card = src.indexOf('<Dimension label="Commercial effect" d={r.verdict.commercial} />');
  const interp = src.indexOf("{r.verdict.interpretation}");
  const interpNote = src.indexOf("a.interpretationNote &&");
  assert.ok(note > 0 && card > note, "commercial note comes before the Commercial effect card");
  assert.ok(interpNote > interp, "interpretation note comes after the Interpretation");
  assert.match(src, /<span className=\{"stamp small " \+ \(DIM_STAMP\[d\.rating\] \|\| ""\)\}>\{d\.rating\}<\/span>/, "the model's rating is rendered as given");
});

test("prompt repeats the commercial rule beside the commercial field in the answer format", () => {
  const field = SYSTEM_PROMPT.indexOf('"commercial": {"rating"');
  assert.ok(field > 0);
  assert.match(SYSTEM_PROMPT.slice(field, field + 500), /MUST be "Unproven" unless "results" holds a dated, scoped, campaign-level/);
});

test("trade-press list includes Moodie Davitt and Marketing-Interactive", () => {
  const tagged = classifySources([site("moodiedavittreport.com"), site("marketing-interactive.com"), site("unknown-trade-mag.com")], { brand: "L'Oréal Paris" });
  assert.deepEqual(tagged.map((s) => [s.type, s.typeBasis]), [["trade_press", "list"], ["trade_press", "list"], ["blog_aggregator", "default"]]);
});

test("figures backed by one site are flagged single source; 'independent' is flagged under 3 non-brand sites", () => {
  const data = fullAnalysis({ verdict: { ...fullAnalysis().verdict, evidence: ["Sales doubled to $4bn.", "Won at Cannes in 2007."] }, context: "Multiple independent sources agree." });
  const a = assessAnalysis(data, [site("adage.com"), site("thedrum.com")], { results: [[0, 1]], evidence: [[0], [0]] }, { brand: "Dove" });
  assert.deepEqual(a.resultFlags[0], []);
  assert.deepEqual(a.evidenceFlags, [["single source"], []]); // a bare year isn't a figure
  assert.equal(a.independentWarning, true);
  assert.equal(assessAnalysis(data, PRESS, {}, { brand: "Dove" }).independentWarning, false);
});

test("criticism search is read from Google's own query log", () => {
  assert.equal(criticismSearched(["dove real beauty 2004", "dove real beauty criticism backlash"]), true);
  assert.equal(criticismSearched(["dove real beauty 2004"]), false);
  assert.equal(criticismSearched(undefined), null);
});

test("sources come only from grounding metadata, deduped, https only", () => {
  const gm = {
    groundingChunks: [
      { web: { uri: "https://vertexaisearch.cloud.google.com/a", title: "unilever.com" } },
      { web: { uri: "https://vertexaisearch.cloud.google.com/a", title: "unilever.com" } },
      { web: { uri: "http://insecure.example", title: "bad" } },
      { web: { uri: "https://vertexaisearch.cloud.google.com/b", title: "" } },
      { retrievedContext: {} },
    ],
  };
  assert.deepEqual(extractSources(gm), [
    { title: "unilever.com", uri: "https://vertexaisearch.cloud.google.com/a" },
    { title: "vertexaisearch.cloud.google.com", uri: "https://vertexaisearch.cloud.google.com/b" },
  ]);
  assert.deepEqual(extractSources(undefined), []);
  assert.deepEqual(extractSources({ webSearchQueries: ["x"] }), []); // the reported "chunks missing" case
});

test("per-claim citations: supports map to deduped source numbers", () => {
  const gm = {
    groundingChunks: [
      { web: { uri: "https://r/a", title: "wikipedia.org" } },
      { web: { uri: "https://r/b", title: "slideshare.net" } },
      { web: { uri: "https://r/a", title: "wikipedia.org" } }, // duplicate of chunk 0
    ],
    groundingSupports: [
      { segment: { text: '"Sales of Dove soap rose from $2 billion to $4 billion in three years.",' }, groundingChunkIndices: [0] },
      { segment: { text: "Sales of Dove firming lotion in the UK rose by 700%" }, groundingChunkIndices: [1, 2] },
    ],
  };
  const { sources, chunkToSource } = extractSourcesWithMap(gm);
  assert.equal(sources.length, 2);
  const cites = citeItems(
    [
      "Sales of Dove soap rose from $2 billion to $4 billion in three years.",
      "Sales of Dove firming lotion in the UK rose by 700%.",
      "Boosted brand affinity by 20% and sales by 11%.",
    ],
    gm,
    chunkToSource
  );
  assert.deepEqual(cites, [[0], [0, 1], []]); // chunk 2 dedupes to source 0
  assert.equal(citeItems(["x"], { groundingChunks: gm.groundingChunks }, chunkToSource), null); // no supports at all
});

test("citations survive shaping and appear on the analysis", () => {
  const shaped = shapeResponse(fullAnalysis(), INPUT, SOURCES(5), { results: [[0]], evidence: [[1]] });
  assert.deepEqual(shaped.citations, { results: [[0]], evidence: [[1]] });
  assert.deepEqual(shapeResponse(fullAnalysis(), INPUT, SOURCES(5)).citations, { results: null, evidence: null });
});

// ---------------------------------------------------------------- input

test("input validation", () => {
  assert.equal(validateInput({ brand: "Dove", campaign: "Real Beauty", year: "2004" }).ok, true);
  assert.deepEqual(validateInput({ brand: " ", campaign: "x", year: 2004 }).errors, ["brand"]);
  assert.deepEqual(validateInput({ brand: "Dove", campaign: "x", year: 3000 }).errors, ["year"]);
  assert.deepEqual(validateInput({ brand: "Dove", campaign: "x", year: "abc" }).errors, ["year"]);
});

// ---------------------------------------------------------------- daily cap

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test("daily cap: 5 per rolling 24h, then resets", () => {
  const s = memoryStorage();
  const t0 = 1_800_000_000_000;
  assert.equal(remainingGenerations(t0, s), CAP_MAX);
  for (let i = 0; i < CAP_MAX; i++) recordGeneration(t0 + i * 1000, s);
  assert.equal(remainingGenerations(t0 + 10_000, s), 0);
  // The first one ages out after 24h, freeing one slot.
  assert.equal(remainingGenerations(t0 + CAP_WINDOW_MS + 1, s), 1);
  assert.equal(remainingGenerations(t0 + CAP_WINDOW_MS + 10_000, s), CAP_MAX);
});

test("daily cap survives corrupt storage", () => {
  const s = memoryStorage();
  s.setItem("ca_generation_timestamps", "{not json");
  assert.equal(remainingGenerations(Date.now(), s), CAP_MAX);
  s.setItem("ca_generation_timestamps", JSON.stringify(["x", null, 5]));
  assert.equal(remainingGenerations(Date.now(), s), CAP_MAX);
});

// ---------------------------------------------------------------- API handler (Gemini mocked)

function fakeRes() {
  return {
    statusCode: 0,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function geminiReply(obj, groundingMetadata) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] }, groundingMetadata }],
    }),
  };
}

const GM = (n) => ({
  webSearchQueries: ["dove campaign for real beauty 2004 results"],
  groundingChunks: SOURCES(n).map((s) => ({ web: s })),
  searchEntryPoint: { renderedContent: "<div>chip</div>" },
});

async function run(replies, body = INPUT) {
  const queue = [...replies];
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  process.env.GEMINI_API_KEY = "test-key";
  const res = fakeRes();
  await handler({ method: "POST", body }, res);
  return { res, calls };
}

test("handler: grounded analysis comes back shaped, with metadata sources", async () => {
  const { res, calls } = await run([geminiReply(fullAnalysis(), GM(6))]);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.outcome, OUTCOME.analysis);
  assert.equal(res.body.sources.length, 6);
  assert.ok(res.body.sources.every((s) => s.type));
  assert.equal(res.body.assessment.criticismSearched, false);
  assert.equal(res.body.confidence, undefined, "confidence comes only from the app assessment");
  assert.equal(res.body.searchSuggestionsHtml, "<div>chip</div>");
  assert.equal(viewFor(res.body).view, OUTCOME.analysis);
});

test("handler: analysis with no grounding sources is withheld after one retry", async () => {
  const { res, calls } = await run([geminiReply(fullAnalysis(), { webSearchQueries: ["q"] }), geminiReply(fullAnalysis(), undefined)]);
  assert.equal(calls, 2);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "no_sources");
});

test("handler: malformed JSON retries once, logs only the error type, then fails clearly", async () => {
  const logged = [];
  const warn = console.warn;
  console.warn = (m) => logged.push(m);
  const secret = fullAnalysis({ context: "GROUNDED-TEXT-MARKER", lessons: ["one only GROUNDED-TEXT-MARKER"] });
  const { res, calls } = await run([geminiReply("not json", GM(3)), geminiReply(secret, GM(3))]);
  console.warn = warn;
  assert.equal(logged.length, 2);
  assert.ok(logged.every((l) => JSON.parse(l).event === "attempt_rejected"));
  assert.match(logged[1], /lessons needs 2-6 items/);
  assert.ok(!logged.join().includes("GROUNDED-TEXT-MARKER"), "logs never carry grounded text");
  assert.equal(calls, 2);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "malformed");
});

test("handler: rate limit, Gemini error, and timeout map to distinct codes", async () => {
  const limited = await run([{ ok: false, status: 429, text: async () => "quota" }, geminiReply(fullAnalysis(), GM(5))]);
  assert.equal(limited.res.body.code, "rate_limited");
  assert.equal(limited.calls, 1, "a 429 must never be retried");
  assert.equal((await run([{ ok: false, status: 400, text: async () => "bad" }])).res.body.code, "gemini");
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  assert.equal((await run([abort])).res.body.code, "timeout");
  const { res, calls } = await run([{ ok: false, status: 503, text: async () => "" }, geminiReply(fullAnalysis(), GM(5))]);
  assert.equal(calls, 2);
  assert.equal(res.statusCode, 200);
});

test("handler: non-beauty decline and bad input", async () => {
  const decline = { isBeauty: false, campaignFound: false, ambiguous: false, message: "Beauty campaigns only.", ...empty };
  const { res } = await run([geminiReply(decline, undefined)], { brand: "Nike", campaign: "Just Do It", year: 1988 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.outcome, OUTCOME.notBeauty);
  assert.equal(res.body.verdict, undefined);

  const bad = await run([], { brand: "", campaign: "x", year: 2004 });
  assert.equal(bad.res.statusCode, 400);
  assert.equal(bad.calls, 0);
});

// ---------------------------------------------------------------- hand-written examples

import { readFileSync } from "node:fs";
import { EXAMPLES } from "../src/data/examples.js";

test("examples are complete, valid analyses with real, in-range citations", () => {
  assert.equal(EXAMPLES.length, 2);
  for (const ex of EXAMPLES) {
    const a = ex.analysis;
    const asLive = { ...a, isBeauty: true, campaignFound: true, ambiguous: false, candidates: [], message: "" };
    assert.deepEqual(validateAnalysis(asLive), [], ex.id);
    assert.ok(a.sources.length > 0, ex.id);
    for (const s of a.sources) {
      assert.match(s.uri, /^https:\/\//, ex.id);
      assert.ok(!s.uri.includes("vertexaisearch"), ex.id + ": examples link to real pages, not grounding redirects");
    }
    for (const list of ["results", "evidence"]) {
      const items = list === "results" ? a.results.items.map((i) => i.text) : a.verdict.evidence;
      assert.equal(a.citations[list].length, items.length, `${ex.id} ${list}: one citation list per item`);
      for (const cites of a.citations[list]) {
        assert.ok(cites.length > 0, `${ex.id} ${list}: every example claim cites a source`);
        for (const n of cites) assert.ok(n >= 0 && n < a.sources.length, `${ex.id} ${list}: citation in range`);
      }
    }
  }
});

test("examples carry the corrected facts and none of the known scope errors", () => {
  const dove = JSON.stringify(EXAMPLES[0].analysis);
  const aesop = JSON.stringify(EXAMPLES[1].analysis);
  assert.match(dove, /Film Grand Prix and the Cyber Grand Prix/);
  assert.ok(!/Titanium/.test(dove), "Evolution did not win the Titanium Grand Prix");
  assert.match(dove, /firming lotion in the UK rose by 700%/);
  assert.ok(!/€\s?6|6 billion|EUR 6/i.test(dove), "Dove's 2023 business total is not a campaign result");
  assert.ok(!/20%|11%/.test(dove), "Reverse Selfie figures don't belong to Real Beauty");
  assert.ok(!/115,000/.test(aesop), "2026 cumulative total is not a 2023 result");
  assert.equal(EXAMPLES[1].analysis.results.available, false);
  assert.match(aesop, /No confirmed outcome exists/);
  assert.ok(!/independent source/i.test(dove + aesop));
  const [d, a] = EXAMPLES.map((ex) => assessAnalysis(ex.analysis, ex.analysis.sources, ex.analysis.citations));
  assert.equal(d.verdict, VERDICT.success);
  assert.equal(d.confidence, "Medium"); // its sales figure is backed by one site only
  assert.equal(a.verdict, VERDICT.someCultural);
  assert.equal(a.confidence, "Medium");
});

test("examples module can't reach the API", () => {
  const src = readFileSync(new URL("../src/data/examples.js", import.meta.url), "utf8");
  assert.ok(!/\bimport\b|fetch\(|\/api\//.test(src.replace(/^\/\/.*$/gm, "")));
});
