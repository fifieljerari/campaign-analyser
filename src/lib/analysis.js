// Shared by api/generate.js (server) and the React app (browser). Pure
// functions only: no fetch, no DOM, so every rule here is unit-tested.
//
// The model returns JSON, but nothing it returns is trusted as-is:
//   - validateAnalysis() checks the exact shape and rejects anything malformed
//   - decideOutcome() turns the flags into ONE outcome the UI renders, and
//     refuses an analysis for non-beauty, unconfirmed, mismatched or
//     ambiguous requests no matter what the analysis fields say
//   - sourceCoverage() rates how many real sources the search returned
//     (counted from grounding metadata, not from the model). It is shown as a
//     separate tool check; the model's own confidence is never overwritten.
//
// Google's grounding terms forbid modifying Grounded Results, so nothing here
// edits the model's content: an answer is either shown as returned (apart
// from dropping empty list entries) or not shown at all.

export const RATINGS = ["Success", "Mixed", "Failure"];
export const CONFIDENCE = ["High", "Medium", "Low"];

export const OUTCOME = {
  analysis: "analysis",
  notBeauty: "notBeauty",
  notFound: "notFound",
  ambiguous: "ambiguous",
  mismatch: "mismatch",
};

const MAX_TEXT = 1200;
// Generous ceilings: a list longer than this is treated as malformed and
// the answer is not shown, rather than being cut down.
const MAX_ITEMS = 20;

// ---------------------------------------------------------------- validation

function isText(v, { allowEmpty = false } = {}) {
  return typeof v === "string" && v.length <= MAX_TEXT && (allowEmpty || v.trim().length > 0);
}

function isTextList(v, { min = 0, max = MAX_ITEMS } = {}) {
  return Array.isArray(v) && v.length >= min && v.length <= max && v.every((x) => isText(x));
}

// Returns a list of problems; an empty list means the object is valid.
export function validateAnalysis(data) {
  const errors = [];
  const need = (cond, msg) => {
    if (!cond) errors.push(msg);
  };

  if (!data || typeof data !== "object" || Array.isArray(data)) return ["response is not a JSON object"];

  for (const k of ["isBeauty", "campaignFound", "ambiguous"]) need(typeof data[k] === "boolean", `${k} must be true or false`);
  if (errors.length) return errors;

  need(isText(data.message, { allowEmpty: true }), "message must be a string");

  if (!data.isBeauty) return errors; // a decline needs nothing else

  if (data.ambiguous) {
    need(isTextList(data.candidates, { min: 2, max: 6 }), "ambiguous needs 2-6 candidate campaigns");
    return errors;
  }

  if (!data.campaignFound) return errors;

  const m = data.matchedCampaign;
  need(m && typeof m === "object", "matchedCampaign is required");
  if (m && typeof m === "object") {
    need(isText(m.brand), "matchedCampaign.brand is required");
    need(isText(m.name), "matchedCampaign.name is required");
    need(Number.isInteger(m.year) && m.year >= 1900 && m.year <= 2100, "matchedCampaign.year must be a year");
  }

  need(CONFIDENCE.includes(data.confidence), "confidence must be High, Medium or Low");
  need(isText(data.confidenceReason), "confidenceReason is required");
  need(isText(data.context), "context is required");
  need(isText(data.objective), "objective is required");

  const w = data.whatTheyDid;
  need(w && typeof w === "object", "whatTheyDid is required");
  if (w && typeof w === "object") {
    need(isText(w.idea), "whatTheyDid.idea is required");
    need(isTextList(w.channels, { min: 1 }), "whatTheyDid.channels needs 1+ items");
    need(isText(w.audience), "whatTheyDid.audience is required");
  }

  const r = data.results;
  need(r && typeof r === "object", "results is required");
  if (r && typeof r === "object") {
    need(typeof r.available === "boolean", "results.available must be true or false");
    need(isTextList(r.items), "results.items must be a list");
    if (r.available === true) need(r.items.length > 0, "results.available is true but no items given");
    if (r.available === false) need(r.items.length === 0, "results.available is false but items were given");
  }

  const rec = data.reception;
  need(rec && typeof rec === "object", "reception is required");
  if (rec && typeof rec === "object") {
    need(isTextList(rec.praise), "reception.praise must be a list");
    need(isTextList(rec.criticism), "reception.criticism must be a list");
    need(isText(rec.backlash, { allowEmpty: true }), "reception.backlash must be a string");
  }

  const v = data.verdict;
  need(v && typeof v === "object", "verdict is required");
  if (v && typeof v === "object") {
    need(RATINGS.includes(v.rating), "verdict.rating must be Success, Mixed or Failure");
    need(isTextList(v.evidence, { min: 1 }), "verdict.evidence needs 1+ items");
    need(isText(v.interpretation), "verdict.interpretation is required");
    need(Array.isArray(v.split), "verdict.split must be a list");
    if (Array.isArray(v.split)) {
      for (const s of v.split) {
        need(s && isText(s.dimension) && RATINGS.includes(s.rating) && isText(s.note), "each verdict.split item needs dimension, rating, note");
      }
      if (v.rating === "Mixed") need(v.split.length >= 2, "a Mixed verdict must be split into 2+ dimensions");
    }
  }

  // The prompt asks for 2-3; up to 6 are accepted and all are shown.
  need(isTextList(data.lessons, { min: 2, max: 6 }), "lessons needs 2-6 items");
  return errors;
}

// Drops blank or non-text entries from lists before validation. An empty
// string carries no content, so removing it changes nothing a reader would
// see. Lists are never shortened.
const LIST_PATHS = [
  "candidates",
  "whatTheyDid.channels",
  "results.items",
  "reception.praise",
  "reception.criticism",
  "verdict.evidence",
  "verdict.split",
  "lessons",
];

export function normalizeAnalysis(data) {
  if (!data || typeof data !== "object") return data;
  const out = structuredClone(data);
  for (const path of LIST_PATHS) {
    const keys = path.split(".");
    const parent = keys.length === 1 ? out : out[keys[0]];
    const key = keys[keys.length - 1];
    if (!parent || typeof parent !== "object" || !Array.isArray(parent[key])) continue;
    parent[key] = parent[key].filter((x) => (typeof x === "string" ? x.trim().length > 0 : x && typeof x === "object"));
  }
  return out;
}

// Pulls the first {...} block out of a model reply (it sometimes wraps JSON
// in ``` fences or adds a sentence). Returns null if nothing parses.
export function parseModelJson(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------- decisions

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// The one place that decides what the user sees. Order matters: the beauty
// guardrail wins over everything, then ambiguity, then "not found", then a
// brand/year cross-check the model can't talk its way past.
export function decideOutcome(data, input) {
  if (!data.isBeauty) return { outcome: OUTCOME.notBeauty };
  if (data.ambiguous) return { outcome: OUTCOME.ambiguous, candidates: data.candidates };
  if (!data.campaignFound) return { outcome: OUTCOME.notFound };

  const m = data.matchedCampaign;
  const brandOk = norm(m.brand).includes(norm(input.brand)) || norm(input.brand).includes(norm(m.brand));
  const yearOk = Math.abs(m.year - Number(input.year)) <= 1; // launches straddle year ends
  if (!brandOk || !yearOk) {
    return {
      outcome: OUTCOME.mismatch,
      found: { brand: m.brand, name: m.name, year: m.year },
      reason: !brandOk ? "brand" : "year",
    };
  }
  return { outcome: OUTCOME.analysis };
}

// How much source material the search actually returned. Shown next to the
// model's confidence as a separate tool check, so a reader can see when the
// model claims more certainty than its sources support.
export function sourceCoverage(sourceCount) {
  return sourceCount >= 5 ? "High" : sourceCount >= 3 ? "Medium" : "Low";
}

export function exceedsCoverage(modelConfidence, sourceCount) {
  return CONFIDENCE.indexOf(modelConfidence) < CONFIDENCE.indexOf(sourceCoverage(sourceCount));
}

// Keep only what an outcome needs, so analysis text can never reach the page
// for a declined, unconfirmed or ambiguous request.
export function shapeResponse(data, input, sources, citations = {}) {
  const decision = decideOutcome(data, input);
  const base = {
    outcome: decision.outcome,
    isBeauty: data.isBeauty,
    campaignFound: data.campaignFound,
    message: data.message || "",
    sources,
  };
  if (decision.outcome === OUTCOME.notBeauty) {
    return { outcome: OUTCOME.notBeauty, isBeauty: false, campaignFound: false, message: base.message };
  }
  if (decision.outcome !== OUTCOME.analysis) return { ...base, ...decision };

  return {
    ...base,
    matchedCampaign: data.matchedCampaign,
    confidence: data.confidence,
    sourceCoverage: sourceCoverage(sources.length),
    confidenceExceedsSources: exceedsCoverage(data.confidence, sources.length),
    confidenceReason: data.confidenceReason,
    context: data.context,
    objective: data.objective,
    whatTheyDid: data.whatTheyDid,
    results: data.results,
    reception: data.reception,
    verdict: data.verdict,
    lessons: data.lessons,
    // null = metadata had no per-passage supports, so nothing could be linked
    citations: {
      results: citations.results ?? null,
      evidence: citations.evidence ?? null,
    },
  };
}

// ---------------------------------------------------------------- sources

// Sources come ONLY from the search tool's grounding metadata, never from
// URLs the model typed. Duplicates (same title + uri) are dropped.
// chunkToSource maps each original groundingChunks index to its position in
// the deduped list, so groundingSupports can be translated to source numbers.
export function extractSourcesWithMap(groundingMetadata) {
  const chunks = groundingMetadata?.groundingChunks;
  const chunkToSource = new Map();
  if (!Array.isArray(chunks)) return { sources: [], chunkToSource };
  const seen = new Map();
  const sources = [];
  chunks.forEach((c, i) => {
    const uri = c?.web?.uri;
    if (typeof uri !== "string" || !/^https:\/\//.test(uri)) return;
    const title = typeof c.web.title === "string" && c.web.title.trim() ? c.web.title.trim() : new URL(uri).hostname;
    const key = title + "|" + uri;
    if (!seen.has(key)) {
      seen.set(key, sources.length);
      sources.push({ title, uri });
    }
    chunkToSource.set(i, seen.get(key));
  });
  return { sources, chunkToSource };
}

export function extractSources(groundingMetadata) {
  return extractSourcesWithMap(groundingMetadata).sources;
}

// ---------------------------------------------------------------- per-claim citations

function words(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9%$€£.]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

// groundingSupports point at passages of the model's raw reply (here, the
// JSON text) and say which search chunks back each passage. An item counts
// as backed by a passage when most of the item's words appear in it, or most
// of a substantial passage's words appear in the item.
function overlaps(itemWords, segWords) {
  if (itemWords.length === 0 || segWords.length < 4) return false;
  const segSet = new Set(segWords);
  const itemSet = new Set(itemWords);
  const inSeg = itemWords.filter((w) => segSet.has(w)).length / itemWords.length;
  const inItem = segWords.filter((w) => itemSet.has(w)).length / segWords.length;
  return inSeg >= 0.7 || inItem >= 0.8;
}

// Returns, for each item, the sorted 0-based source numbers backing it
// (empty = not linked to any specific source). Returns null when the
// metadata carries no supports at all, so the page can say linking wasn't
// possible instead of implying every claim is unlinked.
export function citeItems(items, groundingMetadata, chunkToSource) {
  const supports = groundingMetadata?.groundingSupports;
  if (!Array.isArray(supports) || supports.length === 0) return null;
  const segs = supports
    .map((s) => ({ w: words(s?.segment?.text), chunks: Array.isArray(s?.groundingChunkIndices) ? s.groundingChunkIndices : [] }))
    .filter((s) => s.chunks.length > 0);
  return items.map((item) => {
    const iw = words(item);
    const found = new Set();
    for (const s of segs) {
      if (!overlaps(iw, s.w)) continue;
      for (const c of s.chunks) if (chunkToSource.has(c)) found.add(chunkToSource.get(c));
    }
    return [...found].sort((a, b) => a - b);
  });
}

// ---------------------------------------------------------------- input

export function validateInput(input) {
  const brand = String(input?.brand || "").trim();
  const campaign = String(input?.campaign || "").trim();
  const detail = String(input?.detail || "").trim();
  const year = Number(input?.year);
  const thisYear = new Date().getFullYear();
  const errors = [];
  if (!brand || brand.length > 80) errors.push("brand");
  if (!campaign || campaign.length > 120) errors.push("campaign");
  if (!Number.isInteger(year) || year < 1900 || year > thisYear) errors.push("year");
  if (detail.length > 160) errors.push("detail");
  return { ok: errors.length === 0, errors, value: { brand, campaign, year, detail } };
}

// ---------------------------------------------------------------- browser guard

// The page calls this on whatever the server sent, so a bad or tampered
// response can't render an analysis. Anything that isn't a complete, beauty,
// found, sourced analysis falls back to a non-analysis view or an error.
export function viewFor(resp) {
  if (!resp || typeof resp !== "object") return { view: "error", code: "malformed" };
  if (resp.isBeauty !== true) return { view: OUTCOME.notBeauty };
  if (resp.outcome === OUTCOME.ambiguous) {
    return Array.isArray(resp.candidates) ? { view: OUTCOME.ambiguous } : { view: "error", code: "malformed" };
  }
  if (resp.outcome === OUTCOME.notFound) return { view: OUTCOME.notFound };
  if (resp.outcome === OUTCOME.mismatch) return resp.found ? { view: OUTCOME.mismatch } : { view: "error", code: "malformed" };
  if (resp.outcome !== OUTCOME.analysis || resp.campaignFound !== true) return { view: "error", code: "malformed" };
  if (!Array.isArray(resp.sources) || resp.sources.length === 0) return { view: "error", code: "no_sources" };
  const problems = validateAnalysis({ ...resp, ambiguous: false, candidates: [] });
  return problems.length ? { view: "error", code: "malformed" } : { view: OUTCOME.analysis };
}
