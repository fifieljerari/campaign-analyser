# Campaign Analyser

Was that beauty campaign actually any good? Enter a brand, a campaign name
and a launch year, and Campaign Analyser researches it with a live Google
Search and returns a case file:

- **Context**: the brand's situation and the pressure it faced
- **Objective**: what the campaign was meant to achieve
- **What they did**: the idea, channels and audience
- **Results**: measurable outcomes, only where a source publishes them
- **Reception**: praise, criticism and any backlash
- **Verdict**: Success / Mixed / Failure, "Strong cultural impact, commercial
  effect unproven", or "Insufficient evidence", with a High / Medium / Low
  confidence level. Both are set by the app's evidence rules, with the
  reason shown, and sourced evidence is kept apart from interpretation
- **Lessons for marketers**: two or three takeaways
- **Sources**: the pages the search actually read, each tagged brand-owned,
  trade/business press or blog/aggregator

**Live:** https://campaign-analyser.vercel.app/

Built with AI assistance (Claude Code), directed and reviewed by me.

---

## Why it's grounded in sources

Campaign stories get retold with inflated numbers and wrong years, and a
model answering from memory repeats them confidently. So every analysis
runs Google Search through Gemini's grounding tool, and:

- The **Sources** list comes from the search tool's grounding metadata, not
  from links the model writes. The model is told not to write URLs at all.
- Each result and evidence item links to the specific sources Gemini says
  back it.
- If the model claims to have found a campaign but the search returned no
  sources, the analysis is withheld.

## Honesty rules

| Rule | How it's enforced |
|---|---|
| No statistic, sales figure, award or date without a source | Prompt rule; results have an explicit "No public results found" path |
| Figures keep their scope (product, market, period) and belong to this campaign | Prompt rule; per-claim source links so readers can check |
| Evidence separate from interpretation | Separate `evidence` and `interpretation` fields, shown under separate headings |
| Verdict and confidence follow the evidence, not the model's say-so | Set in code from campaign-level outcomes and non-brand-owned sources (see Limitations); the model only rates cultural impact and commercial effect separately |
| Brand-level growth is not a campaign result | Prompt rule puts it under Context as "Brand-level figures", with an app note; code flags any that slip into Results and never counts them |
| Thin or unscoped figures are visible | Figures backed by one site are tagged "single source"; undated or unscoped ones "scope unclear" |
| Sources aren't called "independent" by default | The prompt forbids the word; if it appears with fewer than three non-brand-owned sites, the app shows a warning |
| Criticism is searched for, not assumed absent | A dedicated criticism and backlash search runs in the same request; an empty section says whether that search ran |
| Can't confirm the campaign → no analysis | A "couldn't confirm" notice; a match whose brand or year (±1) differs from the request is also rejected |
| Ambiguous name → ask for detail | Candidate campaigns are listed and the user is asked for the product or market |

### Beauty only

Beauty means skincare, makeup, haircare, fragrance, personal care and
beauty retail. It's enforced twice: the prompt tells the model to decline
anything else with `isBeauty: false`, and the code refuses to render an
analysis unless `isBeauty` and `campaignFound` are explicitly `true`.
The server strips analysis fields from non-beauty responses, and the page
re-checks every response before rendering it.

---

## How it works

```
Browser (Vite + React)
  └─ POST /api/generate {brand, campaign, year, detail}
       └─ api/generate.js
            ├─ validateInput()
            ├─ Gemini generateContent + tools: [google_search]
            ├─ parseModelJson() → normalizeAnalysis() → validateAnalysis()
            ├─ extractSourcesWithMap() + citeItems()   sources and per-claim links from metadata
            └─ shapeResponse(): decideOutcome() + assessAnalysis()   verdict, confidence, source tags, flags
  ← { outcome: analysis | notBeauty | notFound | ambiguous | mismatch, ... }
Browser: viewFor() re-checks the response before rendering anything
```

- `src/lib/analysis.js`: validation, beauty guardrail, outcome decision,
  source extraction and citation linking. Shared by server and browser.
- `src/lib/prompt.js`: system and user prompts.
- `src/lib/dailyCap.js`: per-browser daily cap with a visible counter.
- `src/data/examples.js`: two hand-written example analyses (see below).
- `src/components/`: form, report, Search Suggestions, notices.
- `api/generate.js`: the serverless function. The API key never reaches the
  browser.
- `tests/analysis.test.js`: unit tests, including the API handler against
  mocked Gemini responses.

The page handles each failure separately: slow search (progress messages),
no sources, campaign not found, ambiguous name, daily quota reached,
malformed answer, timeout, and Gemini or network errors. A 429 from Google
is never retried.

## Google's grounding terms

Grounded answers come with conditions in the
[Gemini API terms](https://ai.google.dev/gemini-api/terms) (section
"Grounding with Google Search"). How the tool complies:

- **Shown only to the person who asked.** Results go straight to the
  requesting browser; nothing is logged, cached or stored by the app.
- **Search Suggestions shown with every grounded answer.** Google's
  Search Suggestions markup is rendered exactly as provided, with every
  analysis and with the not-found, ambiguous and mismatch notices. It's
  isolated in a Shadow DOM rather than an iframe, since the terms forbid
  framing.
- **Not modified.** The model's text is displayed as returned. Lists are
  never shortened (only empty entries are dropped), and the model's
  verdict and confidence are not part of the model's answer: the app sets
  them from the answer's structured fields and the search metadata, and
  shows them in a box labelled "App assessment · set by the evidence rules,
  not by the model". Source-type tags, "single source" / "scope unclear"
  flags and app notes sit in separate, labelled elements, never inside the
  model's sentences.
- **Links go straight to their destination**, with no interstitials.

**Why the examples are hand-written.** The terms don't allow a grounded
answer to be stored and shown to other people, or edited. Grounded text may
only be kept for narrow purposes, such as evaluating your own display or a
user's own chat history. So the two examples on the page (Dove "Campaign
for Real Beauty", 2004, and Aesop "Queer Library", 2023) aren't saved tool
output. They were written by hand from the pages they cite, every claim
was checked against its source, and they're labelled as hand-written. They
open without calling the API or using quota.

---

## Limitations

- **How confidence is calculated.** Confidence never depends on how many
  sources the search returned. The app sets it from two things:
  (a) how many distinct sites are not brand-owned, and (b) whether the
  results include commercial evidence: a campaign-level sales figure,
  effectiveness award or measured result that is dated, has a stated
  scope, and comes with a commercial rating other than "Unproven".
  - **High**: commercial evidence backed by two or more non-brand-owned
    sites, at least one of them trade or business press, and at least
    three distinct non-brand-owned sites overall.
  - **Medium**: commercial evidence that is uncorroborated (one site),
    backed only by blogs, aggregators or Wikipedia, or covered by one or
    two non-brand sites; or no commercial evidence but three or more
    non-brand-owned sites.
  - **Low**: everything else, including sources that are all brand-owned.

  The verdict reads the same commercial-evidence rule, so the two can't
  contradict each other. Without commercial evidence the verdict is
  "Strong / Some cultural impact, commercial effect unproven" (when the
  cultural rating is Strong or Moderate across at least two non-brand
  sites) or "Insufficient evidence". The reason for both is shown on the
  page.
- **Syndicated claims can look like several sources.** Blogs and
  aggregators often repeat one original figure (an Ad Age number, say).
  The app can't tell a copy from independent reporting, which is why High
  confidence also needs trade or business press.
- **The non-brand site count covers the brand, not only the campaign.**
  It includes sources that discuss the brand in general, so a well-known
  brand can show many non-brand sites for a campaign with little coverage
  of its own.
- **Brand-owned detection is a heuristic.** A source is brand-owned when
  the brand or parent-company name is in its domain, when the domain is on
  a short list of parent-company sites (Unilever, L'Oréal, P&G, Estée
  Lauder, Coty, Beiersdorf, Shiseido, Kao, including regional domains such
  as hul.co.in), or when the model classes it as brand-owned. Subsidiary or
  regional domains outside that list, with an unrelated name, can be
  missed. Sources the code can't place are treated as blogs/aggregators,
  the tier that earns no extra trust.
- **"Insufficient evidence" is unit-tested, not live-tested.** In live
  testing, obscure campaigns came back "couldn't confirm" (the search
  didn't surface them), and thinly covered ones still drew enough brand
  coverage for a cultural-impact verdict. The path is covered by unit
  tests only.
- **Criticism may concern the brand rather than the campaign.** The
  criticism search covers the campaign and the brand, so reception can
  include brand-wide issues (a parent company's other products, a later
  ad, the business model) that say little about the campaign itself.
- **Depends on Gemini 2.5 Flash, which Google labels legacy.** Google
  marks `gemini-2.5-flash` as legacy with limited access and could withdraw
  it; 2.5 Flash-Lite is already closed to new users. If it's withdrawn,
  the page shows a clear "analysis couldn't be completed" error, and the
  model needs changing (see below).
- **Grounding on newer models needs billing.** On a free-tier key, grounded
  requests to Gemini 3.x models (`gemini-3.1-flash-lite`,
  `gemini-3.5-flash-lite`) return 429 "exceeded your current quota", even
  though the same models answer normally without grounding.
- **About 20 analyses a day.** The free-tier quota for `gemini-2.5-flash`
  is 20 requests per day for the whole project
  (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), shared by every
  visitor. Each analysis is one grounded request (two if the single retry
  runs); the criticism search runs inside that request. When the quota is
  used up, the page shows "Free daily quota reached, back tomorrow" and
  points to the examples. The `X-Gemini-Attempts` response header and the
  server log (`attempt_rejected`, error type only) show when a retry ran
  and why.
- **The 2-per-day cap is a soft cap.** It lives in the visitor's browser
  and can be bypassed by clearing storage. It spreads the daily quota
  across visitors; it isn't security.
- **Figures can be mis-scoped.** Every figure comes from a search result,
  but the model sometimes widens a figure's scope (a product's sales
  reported as the brand's) or includes results from later campaigns under
  the same platform. The prompt forbids it, but code can't fully prevent
  it. Each figure links to the sources that back it, carries "single
  source" or "scope unclear" tags where they apply, and the page asks
  readers to check scope before reusing one.
- **Results are rarely public.** Most brands don't publish campaign
  outcomes, so "No public results found" and "commercial effect unproven"
  are common.
- **Model judgement.** The cultural and commercial ratings, the
  interpretation and the lessons are the model's reading of the sources.
  Check the sources before relying on them.

---

## Setup

```
npm install
cp .env.example .env.local     # then paste your Gemini key into .env.local
npx vercel dev                 # app + /api together at localhost:3000
```

`npm run dev` runs the frontend alone on port 5173 and proxies `/api` to
`localhost:3000`.

```
npm test
```

### Deploy

```
npx vercel env add GEMINI_API_KEY
npx vercel --prod
```

A free key from https://aistudio.google.com/apikey works.

### Using gemini-3.1-flash-lite (if billing is ever enabled)

The model is one line in `api/generate.js`:

```js
const MODEL = "gemini-2.5-flash";
```

Grounding on Gemini 3.x needs a Google AI project with billing enabled.
Keep that project separate from any free project other tools use, so a
billing change can't affect them:

1. In Google AI Studio, create a **new** Google Cloud project, enable billing
   on it, and set a budget alert or cap in Google Cloud Billing.
2. Create an API key in that project.
3. Replace this project's key: `npx vercel env rm GEMINI_API_KEY`, then
   `npx vercel env add GEMINI_API_KEY` (Production and Preview) with the
   new key.
4. Change the line above to `const MODEL = "gemini-3.1-flash-lite";`,
   run `npm test`, and deploy.
5. Raise `CAP_MAX` in `src/lib/dailyCap.js` if you want to allow more
   analyses per visitor, and update the Limitations section above.
