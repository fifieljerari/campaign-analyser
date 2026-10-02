import { useEffect, useRef, useState } from "react";
import CampaignForm from "./components/CampaignForm.jsx";
import Report from "./components/Report.jsx";
import SearchSuggestions from "./components/SearchSuggestions.jsx";
import { EXAMPLES, EXAMPLES_WRITTEN_ON } from "./data/examples.js";
import { OUTCOME, viewFor } from "./lib/analysis.js";
import { recordGeneration, remainingGenerations } from "./lib/dailyCap.js";

const LOADING_MESSAGES = [
  "Searching for coverage of the campaign…",
  "Checking published results…",
  "Reading the reception…",
  "Weighing the verdict…",
];
const CLIENT_TIMEOUT_MS = 95000; // server budget is 80s

const ERRORS = {
  rate_limited: [
    "Free daily quota reached, back tomorrow",
    "This demo runs on Google's free tier, which allows a small number of live analyses per day for the whole site. Today's are used up; it resets tomorrow. In the meantime, the example analyses below show what a full case file looks like.",
  ],
  no_sources: [
    "No sources to show",
    "The search didn't return any sources we can show you, so the analysis was withheld rather than shown unchecked. Try again, or add the product or market.",
  ],
  timeout: ["The search took too long", "Live research can be slow. Please try again in a moment."],
  malformed: ["The answer didn't pass validation", "The model's answer was incomplete or malformed, so nothing was shown. Please try again."],
  network: ["Couldn't reach the server", "Check your connection and try again."],
  default: ["The analysis couldn't be completed", "The research service returned an error. Please try again in a minute."],
};

function Loading() {
  const [idx, setIdx] = useState(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setIdx(Math.min(Math.floor(seconds / 4), LOADING_MESSAGES.length - 1)), [seconds]);
  return (
    <section className="loading">
      <div className="spinner" />
      <div className="loading-text">{LOADING_MESSAGES[idx]}</div>
      {seconds >= 15 && (
        <div className="loading-slow">
          {seconds >= 35 ? "Still searching. This one is taking longer than usual." : "Live research usually takes 20–60 seconds."}
        </div>
      )}
    </section>
  );
}

// Two hand-written case files that open instantly, with no API call and no
// quota used. See src/data/examples.js for why they're hand-written.
function ExampleList({ onOpen, heading = "Example analyses" }) {
  return (
    <section className="examples" id="examples">
      <div className="examples-label">{heading}</div>
      <p className="examples-sub">
        Hand-written from the listed sources on {EXAMPLES_WRITTEN_ON}, not live tool output. They open instantly and
        don&rsquo;t use the daily quota.
      </p>
      <div className="example-list">
        {EXAMPLES.map((ex) => (
          <button key={ex.id} type="button" className="example-btn" onClick={() => onOpen(ex)}>
            <span className="ex-title">{ex.label}</span>
            <span className="ex-meta">{ex.year} &middot; hand-written example</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Notice({ tone, title, children }) {
  return (
    <section className={"notice " + (tone || "")}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export default function App() {
  const [form, setForm] = useState({ brand: "", campaign: "", year: "", detail: "" });
  const [phase, setPhase] = useState("form"); // form | loading | done | example
  const [example, setExample] = useState(null);
  const [result, setResult] = useState(null); // { view, code?, data?, details? }
  const [remaining, setRemaining] = useState(() => remainingGenerations());
  const detailRef = useRef(null);
  const [focusDetail, setFocusDetail] = useState(false);

  useEffect(() => {
    if (phase === "form" && focusDetail && detailRef.current) {
      detailRef.current.focus();
      setFocusDetail(false);
    }
  }, [phase, focusDetail]);

  function backToForm({ detail = false } = {}) {
    setRemaining(remainingGenerations());
    setPhase("form");
    setFocusDetail(detail);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openExample(ex) {
    setExample(ex);
    setPhase("example");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit() {
    if (remainingGenerations() <= 0) {
      setRemaining(0);
      return;
    }
    recordGeneration();
    setRemaining(remainingGenerations());
    setPhase("loading");
    window.scrollTo({ top: 0, behavior: "smooth" });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const resp = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, year: Number(form.year) }),
        signal: controller.signal,
      });
      let data = null;
      try {
        data = await resp.json();
      } catch {
        data = null;
      }
      if (!resp.ok) {
        setResult({ view: "error", code: data?.code || (resp.status === 429 ? "rate_limited" : "default"), details: data?.details || data?.error });
      } else {
        setResult({ ...viewFor(data), data });
      }
    } catch (err) {
      setResult({ view: "error", code: err?.name === "AbortError" ? "timeout" : "network" });
    } finally {
      clearTimeout(timer);
      setPhase("done");
    }
  }

  const d = result?.data;

  return (
    <>
      <header className="masthead">
        <div className="eyebrow">Learn From the Best</div>
        <h1>Campaign Analyser</h1>
        <p className="tagline">
          Name a beauty campaign. Get the context, what was done, how it landed, and whether it actually worked for the
          brand, built only from what a live search can source.
        </p>
      </header>

      <main>
        {phase === "form" && (
          <>
            <CampaignForm form={form} setForm={setForm} onSubmit={handleSubmit} remaining={remaining} detailRef={detailRef} />
            <ExampleList onOpen={openExample} />
          </>
        )}

        {phase === "example" && example && (
          <>
            <div className="example-banner">
              <strong>Hand-written example &middot; not live tool output</strong>
              Written by hand on {EXAMPLES_WRITTEN_ON} from the sources listed in Exhibit H, in the same layout as a live
              analysis. Every claim was checked against the source it cites. No API call was made and no quota was used.
            </div>
            <Report r={example.analysis} example />
            <button className="refile-btn" style={{ marginTop: 24 }} onClick={() => backToForm()}>
              Back to the Form
            </button>
          </>
        )}

        {phase === "loading" && <Loading />}

        {phase === "done" && result && (
          <>
            {result.view === OUTCOME.analysis && (
              <Report r={d} searchQueries={d.searchQueries || []} searchSuggestionsHtml={d.searchSuggestionsHtml || ""} />
            )}

            {result.view === OUTCOME.notBeauty && (
              <Notice tone="is-ink" title="Beauty campaigns only">
                <p>
                  {d?.message ||
                    "This tool only covers beauty: skincare, makeup, haircare, fragrance, personal care and beauty retail."}
                </p>
                <p>Try a campaign from a beauty brand, like Dove&rsquo;s &ldquo;Campaign for Real Beauty&rdquo; (2004).</p>
                <SearchSuggestions html={d?.searchSuggestionsHtml} />
              </Notice>
            )}

            {result.view === OUTCOME.notFound && (
              <Notice title="Couldn’t confirm this campaign">
                <p>{d.message || "The search couldn't confirm a campaign by this name, brand and year."}</p>
                <p>No analysis was written, because there was nothing reliable to base it on. Check the name and year, or add the product or market.</p>
                <SearchSuggestions html={d.searchSuggestionsHtml} />
              </Notice>
            )}

            {result.view === OUTCOME.mismatch && (
              <Notice title="That doesn’t quite match">
                <p>
                  The closest campaign found was <strong>{d.found.name}</strong> by {d.found.brand} ({d.found.year}), which
                  doesn&rsquo;t match the {d.reason} you entered. No analysis was written. Check the {d.reason}, then try again.
                </p>
                <SearchSuggestions html={d.searchSuggestionsHtml} />
              </Notice>
            )}

            {result.view === OUTCOME.ambiguous && (
              <Notice title="Which campaign did you mean?">
                <p>{d.message || "Several campaigns could match that name and year."}</p>
                <p>Add the product or market to narrow it down, or pick one of these to use as the campaign name:</p>
                <ul className="candidate-list">
                  {d.candidates.map((c) => (
                    <li key={c}>
                      <button
                        type="button"
                        onClick={() => {
                          setForm((f) => ({ ...f, campaign: c }));
                          backToForm();
                        }}
                      >
                        {c}
                      </button>
                    </li>
                  ))}
                </ul>
                <SearchSuggestions html={d.searchSuggestionsHtml} />
              </Notice>
            )}

            {result.view === "error" && (
              <Notice tone="is-red" title={(ERRORS[result.code] || ERRORS.default)[0]}>
                <p>{(ERRORS[result.code] || ERRORS.default)[1]}</p>
                {result.code === "rate_limited" && <ExampleList onOpen={openExample} heading="Example analyses (no quota needed)" />}
                {/* Google's raw quota text isn't useful to visitors; it stays in the API response for debugging. */}
                {result.details && result.code !== "rate_limited" && <p className="details">{String(result.details).slice(0, 200)}</p>}
              </Notice>
            )}

            <button className="refile-btn" style={{ marginTop: 24 }} onClick={() => backToForm({ detail: result.view === OUTCOME.ambiguous })}>
              {result.view === OUTCOME.ambiguous ? "Add Product or Market" : "Analyse Another Campaign"}
            </button>
          </>
        )}
      </main>

      <footer>
        Campaign Analyser is a portfolio demo. Analyses are AI-generated from live Google Search results and should be
        checked against the listed sources before use.
      </footer>
    </>
  );
}
