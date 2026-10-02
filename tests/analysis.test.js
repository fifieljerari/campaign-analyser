import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OUTCOME,
  exceedsCoverage,
  sourceCoverage,
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
    confidence: "High",
    confidenceReason: "Widely covered.",
    context: "Dove faced a commoditised soap market.",
    objective: "Reposition Dove around self-esteem.",
    whatTheyDid: { idea: "Real women, not models.", channels: ["Billboards", "Online film"], audience: "Women 25-54" },
    results: { available: true, items: ["Sales grew after launch (source)."] },
    reception: { praise: ["Widely praised."], criticism: ["Accused of hypocrisy."], backlash: "" },
    verdict: { rating: "Success", evidence: ["Long-running platform."], interpretation: "Built lasting equity.", split: [] },
    lessons: ["Own a purpose.", "Stay consistent."],
    ...overrides,
  };
}

const empty = {
  candidates: [],
  matchedCampaign: null,
  confidence: "Low",
  confidenceReason: "",
  context: "",
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
  assert.ok(validateAnalysis(fullAnalysis({ confidence: "Very high" })).some((e) => e.includes("confidence")));
  assert.ok(validateAnalysis(fullAnalysis({ lessons: ["only one"] })).some((e) => e.includes("lessons")));
  // Four lessons are accepted and ALL shown: grounded results
  // are never trimmed. More than 6 is malformed and not shown at all.
  const four = fullAnalysis({ lessons: ["a", "b", "c", "d"] });
  assert.deepEqual(validateAnalysis(four), []);
  assert.deepEqual(shapeResponse(four, INPUT, SOURCES(5)).lessons, ["a", "b", "c", "d"]);
  assert.ok(validateAnalysis(fullAnalysis({ lessons: ["1", "2", "3", "4", "5", "6", "7"] })).length > 0);
  assert.ok(validateAnalysis(fullAnalysis({ verdict: { rating: "Great", evidence: ["x"], interpretation: "y", split: [] } })).length > 0);
  // Results flag must agree with the items.
  assert.ok(validateAnalysis(fullAnalysis({ results: { available: true, items: [] } })).length > 0);
  assert.ok(validateAnalysis(fullAnalysis({ results: { available: false, items: ["+20% sales"] } })).length > 0);
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

test("a Mixed verdict must be split", () => {
  const mixed = (split) => fullAnalysis({ verdict: { rating: "Mixed", evidence: ["x"], interpretation: "y", split } });
  assert.ok(validateAnalysis(mixed([])).some((e) => e.includes("Mixed")));
  assert.deepEqual(
    validateAnalysis(mixed([
      { dimension: "Brand perception", rating: "Success", note: "Loved." },
      { dimension: "Business results", rating: "Failure", note: "Sales fell." },
    ])),
    []
  );
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

test("model confidence is never overwritten; source coverage is a separate check", () => {
  assert.equal(sourceCoverage(6), "High");
  assert.equal(sourceCoverage(3), "Medium");
  assert.equal(sourceCoverage(1), "Low");
  assert.equal(exceedsCoverage("High", 2), true);
  assert.equal(exceedsCoverage("Low", 9), false);
  const shaped = shapeResponse(fullAnalysis(), INPUT, SOURCES(2));
  assert.equal(shaped.confidence, "High"); // exactly what the model said
  assert.equal(shaped.sourceCoverage, "Low");
  assert.equal(shaped.confidenceExceedsSources, true);
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
  assert.equal(res.body.searchSuggestionsHtml, "<div>chip</div>");
  assert.equal(viewFor(res.body).view, OUTCOME.analysis);
});

test("handler: analysis with no grounding sources is withheld after one retry", async () => {
  const { res, calls } = await run([geminiReply(fullAnalysis(), { webSearchQueries: ["q"] }), geminiReply(fullAnalysis(), undefined)]);
  assert.equal(calls, 2);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "no_sources");
});

test("handler: malformed JSON retries once, then fails clearly", async () => {
  const { res, calls } = await run([geminiReply("not json", GM(3)), geminiReply({ isBeauty: true }, GM(3))]);
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
      const items = list === "results" ? a.results.items : a.verdict.evidence;
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
});

test("examples module can't reach the API", () => {
  const src = readFileSync(new URL("../src/data/examples.js", import.meta.url), "utf8");
  assert.ok(!/\bimport\b|fetch\(|\/api\//.test(src.replace(/^\/\/.*$/gm, "")));
});
