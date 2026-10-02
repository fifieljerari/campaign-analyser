# Campaign Analyser

Was that beauty campaign actually any good? Enter a brand, a campaign name
and a launch year, and Campaign Analyser researches it with a live Google
Search and returns a case file:

- **Context**: the brand's situation and the pressure it faced
- **Objective**: what the campaign was meant to achieve
- **What they did**: the idea, channels and audience
- **Results**: measurable outcomes, only where a source publishes them
- **Reception**: praise, criticism and any backlash
- **Verdict**: Success / Mixed / Failure, with sourced evidence kept apart
  from interpretation, and Mixed verdicts split by dimension
- **Lessons for marketers**: two or three takeaways
- **Sources**: the pages the search actually read

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
| Mixed verdicts are split | A Mixed verdict with fewer than two split dimensions is rejected |
| Confidence reflects the source material | The model's High / Medium / Low is shown as given, next to a separate tool check of how many sources the search returned |
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
            └─ shapeResponse(): decideOutcome() + sourceCoverage()
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
  confidence is never overwritten. App-generated content, such as the
  source-coverage tool check and the "check the scope" note, sits in
  separate, labelled elements rather than inside the model's sentences.
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
  visitor. When it's used up, the page shows "Free daily quota reached,
  back tomorrow" and points to the examples.
- **The 2-per-day cap is a soft cap.** It lives in the visitor's browser
  and can be bypassed by clearing storage. It spreads the daily quota
  across visitors; it isn't security.
- **Figures can be mis-scoped.** Every figure comes from a search result,
  but the model sometimes presents a number from a later year, a different
  product or market, or the brand overall as a result of the campaign,
  especially when the source itself dropped the scope. The prompt forbids
  it, but code can't fully prevent it. Each figure links to the sources
  that back it, and the page asks readers to check scope before reusing
  one.
- **Coverage bias.** Famous campaigns are well documented; small or
  regional ones may come back Low confidence or not found. That's the
  correct answer, not a bug.
- **Results are rarely public.** Most brands don't publish campaign
  outcomes, so "No public results found" is common.
- **Model judgement.** The verdict and lessons are the model's reading of
  the sources. Check the sources before relying on them.

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
