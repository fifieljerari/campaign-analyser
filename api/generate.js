import { SYSTEM_PROMPT, buildUserPrompt } from "../src/lib/prompt.js";
import { citeItems, extractSourcesWithMap, normalizeAnalysis, parseModelJson, shapeResponse, validateAnalysis, validateInput, OUTCOME } from "../src/lib/analysis.js";

// gemini-2.5-flash, not 3.x: on the free tier, Google Search grounding returns
// 429 for Gemini 3.x models unless billing is enabled. 2.5 Flash still
// grounds for free (Google labels it legacy). See README "Limitations".
const MODEL = "gemini-2.5-flash";
// Every call is a grounded request, and free grounded requests are capped
// per day, so at most ONE retry: for an overloaded model, malformed
// JSON, or a "found" answer that came back without any search sources.
const MAX_ATTEMPTS = 2;
// Whole-request budget. A grounded call can take 30s+, so the retry only
// runs if enough time is left for it to finish inside the budget.
const BUDGET_MS = 80000;
const MIN_RETRY_MS = 25000;

async function callGemini(input, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
        tools: [{ google_search: {} }],
      }),
    });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function replyText(candidate) {
  return (candidate?.content?.parts || [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ code: "method", error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ code: "config", error: "Server is missing GEMINI_API_KEY" });
  }

  const checked = validateInput(req.body);
  if (!checked.ok) {
    return res.status(400).json({ code: "input", error: "Missing or invalid fields: " + checked.errors.join(", ") });
  }
  const input = checked.value;

  let lastProblem = "";
  const deadline = Date.now() + BUDGET_MS;
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const timeLeft = deadline - Date.now();
      if (attempt > 1 && timeLeft < MIN_RETRY_MS) break;
      const response = await callGemini(input, apiKey, timeLeft);

      // Quota exhausted: return at once. Never retried, since a retry can't
      // succeed and would only burn more of the 20/day free quota.
      if (response.status === 429) {
        return res.status(429).json({
          code: "rate_limited",
          error: "The free Gemini quota is used up for now.",
          details: (await response.text()).slice(0, 2000),
        });
      }
      if (!response.ok) {
        lastProblem = `Gemini returned ${response.status}`;
        if (response.status === 503 && attempt < MAX_ATTEMPTS) {
          await sleep(1500);
          continue;
        }
        return res.status(502).json({ code: "gemini", error: lastProblem, details: (await response.text()).slice(0, 300) });
      }

      const payload = await response.json();
      const candidate = payload?.candidates?.[0];
      const data = normalizeAnalysis(parseModelJson(replyText(candidate)));
      const problems = data ? validateAnalysis(data) : ["reply was not valid JSON"];
      if (problems.length) {
        lastProblem = "malformed: " + problems.slice(0, 3).join("; ");
        continue;
      }

      const gm = candidate.groundingMetadata;
      const { sources, chunkToSource } = extractSourcesWithMap(gm);
      const citations =
        data.isBeauty && data.campaignFound && !data.ambiguous
          ? {
              results: citeItems(data.results.items, gm, chunkToSource),
              evidence: citeItems(data.verdict.evidence, gm, chunkToSource),
            }
          : {};
      const shaped = shapeResponse(data, input, sources, citations);

      // An analysis with zero search sources can't be checked by anyone, so
      // it is never shown.
      if (shaped.outcome === OUTCOME.analysis && sources.length === 0) {
        lastProblem = "no_sources";
        continue;
      }

      return res.status(200).json({
        ...shaped,
        searchQueries: candidate.groundingMetadata?.webSearchQueries || [],
        // Google's Search Suggestions chip, which the grounding terms require
        // apps to display alongside grounded answers.
        searchSuggestionsHtml: candidate.groundingMetadata?.searchEntryPoint?.renderedContent || "",
      });
    }

    if (lastProblem === "no_sources") {
      return res.status(502).json({
        code: "no_sources",
        error: "The search didn't return any sources we can show, so the analysis was withheld.",
      });
    }
    return res.status(502).json({ code: "malformed", error: "The model's answer didn't pass validation, even after a retry.", details: lastProblem });
  } catch (err) {
    if (err?.name === "AbortError") {
      return res.status(504).json({ code: "timeout", error: "The search took too long to finish." });
    }
    return res.status(500).json({ code: "gemini", error: err?.message || "Unexpected server error" });
  }
}
