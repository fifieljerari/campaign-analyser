// Shared by api/generate.js (server) and the React app (browser). Pure
// functions only: no fetch, no DOM, so every rule here is unit-tested.
//
// The model returns JSON, but nothing it returns is trusted as-is:
//   - validateAnalysis() checks the exact shape and rejects anything malformed
//   - decideOutcome() turns the flags into ONE outcome the UI renders, and
//     refuses an analysis for non-beauty, unconfirmed, mismatched or
//     ambiguous requests no matter what the analysis fields say
//   - assessAnalysis() is the app's own judgement layer: it tags each source
//     (brand-owned / trade-business press / blog-aggregator), flags figures
//     with a single source or unclear scope, and sets the overall verdict and
//     confidence from that evidence. The model is never asked for either.
//
// Google's grounding terms forbid modifying Grounded Results, so nothing here
// edits the model's content: an answer is either shown as returned (apart
// from dropping empty list entries) or not shown at all. Everything
// assessAnalysis() produces is shown in separate, labelled app elements.

export const CONFIDENCE = ["High", "Medium", "Low"];
export const RESULT_TYPES = ["sales", "effectiveness_award", "measured_result", "creative_award", "reach", "output"];
// The result types that count as evidence of the campaign's business effect.
export const OUTCOME_TYPES = ["sales", "effectiveness_award", "measured_result"];
export const CULTURAL_RATINGS = ["Strong", "Moderate", "Weak", "Negative", "Unclear"];
export const COMMERCIAL_RATINGS = ["Positive", "Mixed", "Negative", "Unproven"];
export const SOURCE_TYPES = ["brand_owned", "trade_press", "news", "academic", "blog_aggregator"];
export const SOURCE_TYPE_LABEL = {
  brand_owned: "Brand-owned",
  trade_press: "Trade/business press",
  news: "General news",
  academic: "Academic/institutional",
  blog_aggregator: "Blog/aggregator",
};

export const VERDICT = {
  success: "Success",
  mixed: "Mixed",
  failure: "Failure",
  cultural: "Strong cultural impact, commercial effect unproven",
  someCultural: "Some cultural impact, commercial effect unproven",
  insufficient: "Insufficient evidence",
};

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

  need(isText(data.parentCompany, { allowEmpty: true }), "parentCompany must be a string");
  need(isText(data.context), "context is required");
  need(isTextList(data.brandContext), "brandContext must be a list");
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
    need(Array.isArray(r.items) && r.items.length <= MAX_ITEMS && r.items.every(isResultItem), "results.items must be a list of {text, type, dated, scopeStated}");
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
    need(isDimension(v.cultural, CULTURAL_RATINGS), "verdict.cultural needs a rating and note");
    need(isDimension(v.commercial, COMMERCIAL_RATINGS), "verdict.commercial needs a rating and note");
    need(isTextList(v.evidence, { min: 1 }), "verdict.evidence needs 1+ items");
    need(isText(v.interpretation), "verdict.interpretation is required");
  }

  need(
    Array.isArray(data.sourceTypes) &&
      data.sourceTypes.length <= 40 &&
      data.sourceTypes.every((s) => s && isText(s.domain) && SOURCE_TYPES.includes(s.type)),
    "sourceTypes must be a list of {domain, type}"
  );

  // The prompt asks for 2-3; up to 6 are accepted and all are shown.
  need(isTextList(data.lessons, { min: 2, max: 6 }), "lessons needs 2-6 items");
  return errors;
}

function isResultItem(x) {
  return (
    x && typeof x === "object" && isText(x.text) && RESULT_TYPES.includes(x.type) && typeof x.dated === "boolean" && typeof x.scopeStated === "boolean"
  );
}

function isDimension(d, ratings) {
  return d && typeof d === "object" && ratings.includes(d.rating) && isText(d.note);
}

// Drops blank or non-text entries from lists before validation. An empty
// string carries no content, so removing it changes nothing a reader would
// see. Lists are never shortened.
const LIST_PATHS = [
  "candidates",
  "brandContext",
  "whatTheyDid.channels",
  "results.items",
  "reception.praise",
  "reception.criticism",
  "verdict.evidence",
  "sourceTypes",
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

// ---------------------------------------------------------------- judgement layer

function fold(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function compact(s) {
  return fold(s).replace(/[^a-z0-9]/g, "");
}

// The site a source came from. Grounding links point at a Google redirect,
// so for those the title (which Google sets to the site's domain) is used.
export function sourceDomain(source) {
  let host = "";
  try {
    host = new URL(source.uri).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (!host || /(^|\.)(vertexaisearch\.cloud\.google\.com|google\.com)$/.test(host)) {
    const t = String(source.title || "").trim().toLowerCase();
    host = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(t) ? t : "";
  }
  return host.replace(/^www\./, "");
}

function bareDomain(d) {
  return String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

function sameSite(a, b) {
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

// Words too generic to identify a brand's own domain.
const GENERIC_WORDS = new Set(["paris", "london", "york", "beauty", "cosmetics", "group", "company", "inc", "the", "and", "skin", "care", "professional", "procter", "gamble", "johnson"]);

// Brand and parent-company names as they'd appear in a domain:
// "L'Oréal Paris" -> lorealparis, oreal; "Procter & Gamble" -> pg.
export function ownerTokens(brand, parentCompany = "") {
  const out = new Set();
  for (const name of [brand, parentCompany]) {
    const full = compact(name);
    if (full.length >= 3) out.add(full);
    for (const w of fold(name).split(/[\s&,/()-]+/).map(compact)) if (w.length >= 3 && !GENERIC_WORDS.has(w)) out.add(w);
  }
  if (/procter|p\s*&\s*g/i.test(parentCompany)) out.add("pg");
  return [...out];
}

function isOwnedDomain(domain, tokens) {
  const labels = domain.split(".").slice(0, -1).map(compact); // drop the TLD
  return tokens.some((t) => labels.some((l) => (t.length >= 4 ? l.includes(t) : l === t)));
}

// Trade, business and news publications, recognised without asking the model.
const KNOWN_PRESS = [
  "adage.com", "adweek.com", "campaignlive.co.uk", "campaignlive.com", "marketingweek.com", "thedrum.com", "warc.com",
  "effie.org", "canneslions.com", "lovethework.com", "ipa.co.uk", "dandad.org", "oneclub.org", "mediapost.com",
  "marketingdive.com", "retaildive.com", "businessinsider.com", "forbes.com", "fortune.com", "ft.com", "wsj.com",
  "reuters.com", "bloomberg.com", "cnbc.com", "economist.com", "fastcompany.com", "hbr.org", "wwd.com", "voguebusiness.com", "businessoffashion.com", "glossy.co", "cosmeticsbusiness.com", "cosmeticsdesign.com",
  "cosmeticsdesign-europe.com", "cosmeticsdesign-asia.com", "beautyindependent.com", "happi.com", "premiumbeautynews.com",
];

// General news and consumer media: credible reporting, but not the trade or
// business press that High confidence needs.
const KNOWN_NEWS = [
  "nytimes.com", "washingtonpost.com", "theguardian.com", "bbc.co.uk", "bbc.com", "cnn.com", "aljazeera.com",
  "laweekly.com", "latimes.com", "time.com", "independent.co.uk", "telegraph.co.uk", "apnews.com", "npr.org",
  "usatoday.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com", "cbc.ca", "vice.com", "huffpost.com",
  "dailymail.co.uk", "thetimes.co.uk", "vox.com", "theatlantic.com", "newyorker.com", "vogue.com", "vogue.co.uk",
  "allure.com", "elle.com", "harpersbazaar.com", "cosmopolitan.com", "glamour.com", "refinery29.com", "marieclaire.co.uk",
  "wallpaper.com", "timeout.com", "hypebeast.com",
];

// Universities, government and other institutions, recognised by domain.
const ACADEMIC_DOMAIN = /\.(edu|gov|mil|int)$|\.(ac|edu|gov)\.[a-z]{2}$|\.museum$/;

// Aggregators that never count as trade or business press, whatever the
// model says: wikis, document and slide sharing, blogging platforms.
const KNOWN_AGGREGATORS = [
  "wikipedia.org", "wikiwand.com", "fandom.com", "scribd.com", "slideshare.net", "studocu.com", "coursehero.com",
  "medium.com", "substack.com", "blogspot.com", "wordpress.com", "tumblr.com", "youtube.com", "pinterest.com", "reddit.com",
];

// Parent companies and the corporate and regional domains they own, for
// subsidiaries whose domain doesn't contain the parent's name (hul.co.in is
// Hindustan Unilever). A domain here is brand-owned only when the analysed
// brand belongs to that parent; otherwise it is a competitor's site.
export const PARENT_DOMAINS = {
  unilever: ["unilever.com", "unileverusa.com", "unilever.co.uk", "hul.co.in", "hindustanunilever.com", "unilever.com.au", "unilevernotices.com"],
  loreal: ["loreal.com", "loreal-finance.com", "lorealusa.com", "loreal.co.uk", "loreal.fr", "lorealparisusa.com", "loreal-paris.co.uk", "loreal-paris.fr"],
  pg: ["pg.com", "pgcareers.com", "pgbrands.com", "pgeveryday.com", "pg.co.uk", "pgindia.com"],
  esteelauder: ["elcompanies.com", "esteelauder.com", "esteelauder.co.uk"],
  coty: ["coty.com", "cotyinc.com"],
  beiersdorf: ["beiersdorf.com", "beiersdorf.de", "beiersdorf.co.uk", "beiersdorf.us"],
  shiseido: ["shiseido.com", "shiseido.co.jp", "shiseidogroup.com", "corp.shiseido.com"],
  kao: ["kao.com", "kao.co.jp", "kaousa.com"],
};

// Which PARENT_DOMAINS entries apply to this brand: the brand or its parent
// company names the key (L'Oréal Paris -> loreal, Procter & Gamble -> pg).
function parentDomainsFor(brand, parentCompany) {
  const names = [brand, parentCompany].map(compact).filter(Boolean);
  const keyMatches = { pg: /procter|pandg|^pg$/, esteelauder: /esteelauder/ };
  return Object.entries(PARENT_DOMAINS)
    .filter(([key]) => names.some((n) => (keyMatches[key] ? keyMatches[key].test(n) : n.includes(key))))
    .flatMap(([, domains]) => domains);
}

// Tags every source. Brand-owned if ANY of: the domain is on the parent's
// alias list, the brand/parent name is in the domain, or the model classed
// it as brand-owned. Otherwise the known-aggregator list (Wikipedia etc.),
// academic/institutional domains (.edu, .ac.uk, .gov...), the trade/business
// press list, the general-news list, then the model's classification;
// anything left is a blog/aggregator, the type that earns no extra trust.
// Only trade/business press counts towards High confidence.
export function classifySources(sources, { brand, parentCompany = "", sourceTypes = [] }) {
  const tokens = ownerTokens(brand, parentCompany);
  const parentDomains = parentDomainsFor(brand, parentCompany);
  const modelTypes = sourceTypes.map((s) => ({ domain: bareDomain(s.domain), type: s.type })).filter((s) => s.domain);
  return sources.map((s) => {
    const domain = sourceDomain(s);
    let type = "blog_aggregator";
    let basis = "default";
    const m = domain && modelTypes.find((t) => sameSite(domain, t.domain));
    // Brand-owned if EITHER the domain check OR the model says so; either
    // signal is enough to withhold the trust a non-brand source earns.
    if (domain && parentDomains.some((d) => sameSite(domain, d))) [type, basis] = ["brand_owned", "alias"];
    else if (domain && isOwnedDomain(domain, tokens)) [type, basis] = ["brand_owned", "domain"];
    else if (m?.type === "brand_owned") [type, basis] = ["brand_owned", "model"];
    else if (domain && KNOWN_AGGREGATORS.some((k) => sameSite(domain, k))) [type, basis] = ["blog_aggregator", "list"];
    else if (domain && ACADEMIC_DOMAIN.test(domain)) [type, basis] = ["academic", "domain"];
    else if (domain && KNOWN_PRESS.some((k) => sameSite(domain, k))) [type, basis] = ["trade_press", "list"];
    else if (domain && KNOWN_NEWS.some((k) => sameSite(domain, k))) [type, basis] = ["news", "list"];
    else if (m) [type, basis] = [m.type, "model"];
    return { ...s, domain, type, typeBasis: basis };
  });
}

function siteKey(s) {
  return s.domain || compact(s.title);
}

// Brand- or company-wide figures that must never count as a campaign result.
const BRAND_LEVEL = /market (value|cap)|total (revenue|sales|turnover)|(group|company|net|annual|organic) (sales|revenue|turnover)|brand value|valuation|revenue of the (brand|company)/i;

// A number other than a bare year.
function hasFigure(text) {
  return /\d/.test(String(text).replace(/\b(19|20)\d{2}s?\b/g, ""));
}

// The app's own flags for one claim, from the citations of that claim.
function claimFlags(text, cites, tagged) {
  const flags = [];
  if (Array.isArray(cites) && cites.length > 0 && hasFigure(text)) {
    const sites = new Set(cites.map((n) => tagged[n]).filter(Boolean).map(siteKey));
    if (sites.size === 1) flags.push("single source");
  }
  return flags;
}

function plural(n, one, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

const CRITICISM_QUERY = /critic|controvers|backlash|boycott|outrage|problematic|hypocri|scandal/i;

export function criticismSearched(searchQueries) {
  if (!Array.isArray(searchQueries)) return null;
  return searchQueries.some((q) => CRITICISM_QUERY.test(String(q)));
}

function allModelText(data) {
  const parts = [data.context, data.objective, data.whatTheyDid?.idea, data.whatTheyDid?.audience, data.reception?.backlash, data.verdict?.interpretation, data.verdict?.cultural?.note, data.verdict?.commercial?.note];
  for (const list of [data.brandContext, data.reception?.praise, data.reception?.criticism, data.verdict?.evidence, data.lessons]) parts.push(...(list || []));
  parts.push(...(data.results?.items || []).map((i) => i.text));
  return parts.filter(Boolean).join("\n");
}

// The judgement layer. Everything returned here is the app's own analysis,
// derived from the grounded answer and its metadata, and is shown in
// separate, labelled elements. It never edits the model's text.
//
// Confidence depends on two things only, never on how many sources there are:
//   (a) distinct sites that are NOT brand-owned, and
//   (b) whether any campaign-level outcome exists: a sales figure, an
//       effectiveness award or a measured result, dated, with its scope stated.
export function assessAnalysis(data, sources, citations = {}, { brand = data.matchedCampaign?.brand, searchQueries } = {}) {
  const tagged = classifySources(sources, { brand, parentCompany: data.parentCompany || "", sourceTypes: data.sourceTypes || [] });
  const nonBrandSites = [...new Set(tagged.filter((s) => s.type !== "brand_owned").map(siteKey))];
  const k = nonBrandSites.length;

  const items = data.results?.items || [];
  const resultCites = citations.results ?? null;
  const resultFlags = items.map((item, i) => {
    const flags = claimFlags(item.text, resultCites?.[i], tagged);
    if (!item.scopeStated || !item.dated) flags.push("scope unclear");
    if (BRAND_LEVEL.test(item.text)) flags.push("brand-level, not counted as a campaign result");
    const c = resultCites?.[i];
    if (Array.isArray(c) && c.length > 0 && c.every((n) => tagged[n]?.type === "brand_owned")) flags.push("brand's own claim");
    return flags;
  });
  const evidenceCites = citations.evidence ?? null;
  const evidenceFlags = (data.verdict?.evidence || []).map((t, i) => claimFlags(t, evidenceCites?.[i], tagged));

  const cultural = data.verdict?.cultural?.rating;
  const commercial = data.verdict?.commercial?.rating;

  // ONE rule, read by both the verdict and the confidence: commercial
  // evidence exists only when the results include a dated, scoped,
  // campaign-level sales figure, effectiveness award or measured result AND
  // the commercial rating isn't "Unproven". Neither can contradict the other.
  const taggedOutcomes = items
    .map((item, i) => (OUTCOME_TYPES.includes(item.type) && item.dated && item.scopeStated && !BRAND_LEVEL.test(item.text) ? i : -1))
    .filter((i) => i >= 0);
  const outcomeIdx = commercial && commercial !== "Unproven" ? taggedOutcomes : [];
  const hasOutcome = outcomeIdx.length > 0;
  // Outcomes whose linked sources are all brand-owned are the brand's own
  // claim. Unlinked outcomes can't be checked either way and don't count here.
  const brandOnlyOutcome =
    hasOutcome &&
    outcomeIdx.every((i) => {
      const c = resultCites?.[i];
      return Array.isArray(c) && c.length > 0 && c.every((n) => tagged[n]?.type === "brand_owned");
    });
  // High confidence needs at least one outcome that two or more different
  // non-brand-owned sites back. A single site (or an unlinked claim) can't
  // corroborate itself.
  const corroborated = outcomeIdx.some((i) => {
    const c = resultCites?.[i];
    return Array.isArray(c) && new Set(c.map((n) => tagged[n]).filter((s) => s && s.type !== "brand_owned").map(siteKey)).size >= 2;
  });
  // ...and at least one trade or business press site among an outcome's
  // sources, so Wikipedia and blogs repeating each other can't reach High.
  const pressBacked = outcomeIdx.some((i) => {
    const c = resultCites?.[i];
    return Array.isArray(c) && c.some((n) => tagged[n]?.type === "trade_press");
  });
  const commercialEvidence = { present: hasOutcome, count: outcomeIdx.length, corroborated, pressBacked, brandOnly: brandOnlyOutcome };

  const outcomeWords = "a campaign-level sales figure, effectiveness award or measured result";
  // Why there's no commercial evidence, said the same way in both reasons.
  let missing;
  if (taggedOutcomes.length > 0) missing = `the outcome figures found don't show a business effect for this campaign (commercial rating: ${commercial})`;
  else if (items.some((item) => OUTCOME_TYPES.includes(item.type)) || (data.brandContext || []).length > 0)
    missing = `no source gives ${outcomeWords}; the only figures are brand-level, undated or without a stated scope`;
  else missing = `no source gives ${outcomeWords}`;

  let confidence;
  let confidenceReason;
  if (hasOutcome && corroborated && pressBacked && k >= 3) {
    confidence = "High";
    confidenceReason = `The sources include ${plural(outcomeIdx.length, "campaign-level outcome")} (sales, effectiveness awards or measured results, dated and scoped), backed by two or more non-brand-owned sites including trade or business press, and ${plural(k, "distinct non-brand-owned site")} cover the campaign.`;
  } else if (hasOutcome && corroborated && !pressBacked && !brandOnlyOutcome && k >= 1) {
    confidence = "Medium";
    confidenceReason = `There is ${outcomeWords} backed by two or more non-brand-owned sites, but none of them is trade or business press (only blogs, aggregators or Wikipedia, which often repeat one original claim). ${plural(k, "distinct non-brand-owned site")} cover the campaign.`;
  } else if (hasOutcome && brandOnlyOutcome) {
    confidence = k >= 1 ? "Medium" : "Low";
    confidenceReason = `The campaign-level outcome figures are linked only to brand-owned sources, so they are the brand's own claims. ${plural(k, "distinct non-brand-owned site")} cover the campaign.`;
  } else if (hasOutcome && k >= 1 && !corroborated) {
    confidence = "Medium";
    confidenceReason = `There is ${outcomeWords}, but no such outcome is backed by two or more non-brand-owned sites (each rests on one site or isn't linked to a source), so it is uncorroborated. ${plural(k, "distinct non-brand-owned site")} cover the campaign.`;
  } else if (hasOutcome && k >= 1) {
    confidence = "Medium";
    confidenceReason = `There is ${outcomeWords}, but only ${plural(k, "distinct non-brand-owned site")} cover the campaign. High confidence needs at least 3.`;
  } else if (hasOutcome) {
    confidence = "Low";
    confidenceReason = `There is ${outcomeWords}, but every source is brand-owned.`;
  } else if (k >= 3) {
    confidence = "Medium";
    confidenceReason = `${plural(k, "distinct non-brand-owned site")} cover the campaign, but ${missing}, so the commercial effect can't be judged.`;
  } else {
    confidence = "Low";
    confidenceReason = `Only ${plural(k, "distinct non-brand-owned site")} cover the campaign, and ${missing}.`;
  }

  let verdict;
  let verdictReason;
  if (hasOutcome) {
    if (commercial === "Positive") verdict = cultural === "Negative" ? VERDICT.mixed : VERDICT.success;
    else if (commercial === "Negative") verdict = cultural === "Strong" ? VERDICT.mixed : VERDICT.failure;
    else verdict = VERDICT.mixed;
    verdictReason = `Set from the commercial rating (${commercial}) and cultural rating (${cultural}) below, backed by ${plural(outcomeIdx.length, "campaign-level outcome")}.`;
  } else if ((cultural === "Strong" || cultural === "Moderate") && k >= 2) {
    verdict = cultural === "Strong" ? VERDICT.cultural : VERDICT.someCultural;
    verdictReason = `The sources support a cultural impact (rated ${cultural}, across ${plural(k, "non-brand-owned site")}), but ${missing}, so the commercial effect is unproven.`;
  } else {
    verdict = VERDICT.insufficient;
    verdictReason = `${missing[0].toUpperCase() + missing.slice(1)}, and there isn't enough non-brand coverage to judge the cultural impact instead.`;
  }

  return {
    sources: tagged,
    nonBrandSites: k,
    commercialEvidence,
    confidence,
    confidenceReason,
    verdict,
    verdictReason,
    // The app's own line under the Commercial effect card whenever the
    // assessment treats the commercial effect as unproven.
    commercialNote: hasOutcome
      ? null
      : `${commercial && commercial !== "Unproven" ? `The model rated this "${commercial}", but the` : "The"} app treats the commercial effect as unproven: ${missing}.`,
    resultFlags,
    evidenceFlags,
    independentWarning: k < 3 && /\bindependent\b/i.test(allModelText(data)),
    criticismSearched: criticismSearched(searchQueries),
  };
}

// Keep only what an outcome needs, so analysis text can never reach the page
// for a declined, unconfirmed or ambiguous request.
export function shapeResponse(data, input, sources, citations = {}, searchQueries) {
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

  const assessment = assessAnalysis(data, sources, citations, { brand: input.brand, searchQueries });
  return {
    ...base,
    sources: assessment.sources,
    assessment: (({ sources: _tagged, ...rest }) => rest)(assessment),
    matchedCampaign: data.matchedCampaign,
    parentCompany: data.parentCompany,
    context: data.context,
    brandContext: data.brandContext,
    sourceTypes: data.sourceTypes,
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
  if (!resp.assessment || !CONFIDENCE.includes(resp.assessment.confidence) || !Object.values(VERDICT).includes(resp.assessment.verdict)) {
    return { view: "error", code: "malformed" };
  }
  const problems = validateAnalysis({ ...resp, ambiguous: false, candidates: [] });
  return problems.length ? { view: "error", code: "malformed" } : { view: OUTCOME.analysis };
}
