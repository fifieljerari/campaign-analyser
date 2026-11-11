import SearchSuggestions from "./SearchSuggestions.jsx";
import { SOURCE_TYPE_LABEL, VERDICT } from "../lib/analysis.js";

// The analysis, in the same lettered "Exhibit" layout as Market Entry Dossier.
// Live answers are only rendered after viewFor() has confirmed a complete,
// beauty, found, sourced analysis, and their text is shown exactly as Gemini
// returned it. Everything the app adds (the verdict, confidence, source-type
// tags, claim flags, notes) comes from assessAnalysis() and sits in separate
// elements marked as the app's own, never inside the model's sentences.
// Also renders the hand-written examples (example = true), which aren't
// grounded output.

const STAMP = {
  [VERDICT.success]: "is-success",
  [VERDICT.mixed]: "is-mixed",
  [VERDICT.failure]: "is-failure",
  [VERDICT.cultural]: "is-partial is-long",
  [VERDICT.someCultural]: "is-partial is-long",
  [VERDICT.insufficient]: "is-insufficient is-long",
};

const DIM_STAMP = {
  Strong: "is-success",
  Positive: "is-success",
  Moderate: "is-mixed",
  Mixed: "is-mixed",
  Weak: "is-failure",
  Negative: "is-failure",
  Unclear: "",
  Unproven: "",
};

function Bullets({ items, empty }) {
  if (!items || items.length === 0) return <p className="empty-line">{empty}</p>;
  return (
    <ul className="bullet-list">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

// App-added flags on one claim, visibly separate from the claim's text.
function Flags({ flags }) {
  if (!flags || flags.length === 0) return null;
  return (
    <span className="app-flags">
      {flags.map((f) => (
        <span key={f} className="app-flag" title="Added by the app, not part of the grounded answer">
          {f}
        </span>
      ))}
    </span>
  );
}

// Bullets with numbered source links taken from the grounding metadata's
// per-passage supports (the Links Google provides for citing). cites === null
// means the metadata had no supports, so nothing could be linked. Unlinked
// items are counted in a note below the list rather than labelled inline.
function CitedBullets({ items, cites, sources, flags = [] }) {
  const unlinked = cites ? cites.filter((c) => !c || c.length === 0).length : 0;
  return (
    <>
      <ul className="bullet-list">
        {items.map((t, i) => (
          <li key={i}>
            {t}
            {cites && cites[i] && cites[i].length > 0 && (
              <span className="cites">
                {cites[i].map((n) => (
                  <a key={n} href={sources[n]?.uri} target="_blank" rel="noopener noreferrer" title={sources[n]?.title}>
                    [{n + 1}]
                  </a>
                ))}
              </span>
            )}
            <Flags flags={flags[i]} />
          </li>
        ))}
      </ul>
      {cites === null && (
        <p className="cite-note">These couldn&rsquo;t be linked to individual sources for this answer. Check them against the Sources list.</p>
      )}
      {unlinked > 0 && (
        <p className="cite-note">
          {unlinked} of {items.length} {items.length === 1 ? "item isn't" : "items aren't"} linked to a specific source. Check{" "}
          {unlinked === 1 ? "it" : "them"} against the Sources list.
        </p>
      )}
    </>
  );
}

function Exhibit({ letter, title, children }) {
  return (
    <div className="exhibit">
      <div className="exhibit-label">Exhibit {letter}</div>
      <h3 className="exhibit-title">{title}</h3>
      {children}
    </div>
  );
}

// Says what an empty criticism or backlash field means, given whether a
// dedicated criticism search ran (read from Google's own search log).
function noneFound(searched, what) {
  if (searched === true) return `Searched for criticism and backlash, no ${what} found in these sources.`;
  if (searched === false) return `No ${what} found in these sources. A dedicated criticism search didn't run for this answer, so this is unchecked.`;
  return `No ${what} found in these sources.`;
}

function Dimension({ label, d }) {
  return (
    <div className="split-row">
      <span className={"stamp small " + (DIM_STAMP[d.rating] || "")}>{d.rating}</span>
      <div>
        <div className="split-dim">{label}</div>
        <div className="split-note">{d.note}</div>
      </div>
    </div>
  );
}

export default function Report({ r, searchQueries = [], searchSuggestionsHtml = "", example = false }) {
  const m = r.matchedCampaign;
  const a = r.assessment;
  const brandContext = r.brandContext || [];
  return (
    <>
      <div className="case-summary">
        Case File &middot; {m.brand} &middot; {m.name} &middot; {m.year}
      </div>

      <Exhibit letter="A" title="Context">
        <p>{r.context}</p>
        {brandContext.length > 0 && (
          <>
            <h4>Brand-level figures</h4>
            <Bullets items={brandContext} />
            <p className="app-note">
              <span className="app-note-label">App note</span>
              These describe the brand or company as a whole, not this campaign, so they are background only and don&rsquo;t
              count towards the verdict.
            </p>
          </>
        )}
      </Exhibit>

      <Exhibit letter="B" title="Objective">
        <p>{r.objective}</p>
      </Exhibit>

      <Exhibit letter="C" title="What They Did">
        <p>{r.whatTheyDid.idea}</p>
        <h4>Channels</h4>
        <ul className="chip-list">
          {r.whatTheyDid.channels.map((c, i) => (
            <li className="chip" key={i}>
              {c}
            </li>
          ))}
        </ul>
        <h4>Audience</h4>
        <p>{r.whatTheyDid.audience}</p>
      </Exhibit>

      <Exhibit letter="D" title="Results">
        {r.results.available ? (
          <>
            <CitedBullets
              items={r.results.items.map((i) => i.text)}
              cites={r.citations?.results ?? null}
              sources={r.sources}
              flags={a.resultFlags}
            />
            <p className="cite-note">
              Figures are as reported by the linked sources. Check the scope (product, market, period) before reusing one. Dashed
              tags such as &ldquo;single source&rdquo; are added by the app, not part of the answer.
            </p>
          </>
        ) : (
          <p className="empty-line">No public results found. The brand doesn&rsquo;t appear to have published measurable outcomes for this campaign.</p>
        )}
      </Exhibit>

      <Exhibit letter="E" title="Reception">
        <h4>Praise</h4>
        <Bullets items={r.reception.praise} empty="No notable praise found in these sources." />
        <h4>Criticism</h4>
        <Bullets items={r.reception.criticism} empty={noneFound(a.criticismSearched, "criticism")} />
        <h4>Backlash</h4>
        <p className={r.reception.backlash ? "" : "empty-line"}>{r.reception.backlash || noneFound(a.criticismSearched, "backlash")}</p>
      </Exhibit>

      <Exhibit letter="F" title="Verdict">
        <div className="app-assessment">
          <span className="app-note-label">App assessment &middot; set by the evidence rules, not by the model</span>
          <div className={"stamp " + (STAMP[a.verdict] || "")}>{a.verdict}</div>
          <p className="assessment-reason">{a.verdictReason}</p>
          <div className="confidence-line">
            Confidence: <strong>{a.confidence}</strong>
          </div>
          <p className="assessment-reason">{a.confidenceReason}</p>
          {a.independentWarning && (
            <p className="assessment-reason is-warn">
              The text below uses the word &ldquo;independent&rdquo;, but only {a.nonBrandSites} distinct non-brand-owned{" "}
              {a.nonBrandSites === 1 ? "site is" : "sites are"} in the sources. The app treats sources as independent only when
              at least three non-brand-owned sites back a point.
            </p>
          )}
        </div>
        <h4>Ratings by dimension (analysis)</h4>
        <Dimension label="Cultural impact" d={r.verdict.cultural} />
        <Dimension label="Commercial effect" d={r.verdict.commercial} />
        {a.commercialNote && (
          <p className="app-note">
            <span className="app-note-label">App note</span>
            {a.commercialNote}
          </p>
        )}
        <h4>Evidence (from sources)</h4>
        <CitedBullets items={r.verdict.evidence} cites={r.citations?.evidence ?? null} sources={r.sources} flags={a.evidenceFlags} />
        <h4>Interpretation (analysis)</h4>
        <p>{r.verdict.interpretation}</p>
      </Exhibit>

      <Exhibit letter="G" title="Lessons for Marketers">
        <Bullets items={r.lessons} />
      </Exhibit>

      <Exhibit letter="H" title="Sources">
        <p className="empty-line">
          {example
            ? "The pages this example was written from. Each claim above was checked against them by hand."
            : "Taken from the search tool’s own records of what it read, not from links the model wrote."}{" "}
          Source-type tags are added by the app: brand-owned when the brand or parent company is in the domain, otherwise from
          a list of known publications or the model&rsquo;s classification.
        </p>
        <ol className="source-list">
          {r.sources.map((s, i) => (
            <li key={i}>
              <a href={s.uri} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
              {s.type && (
                <span className={"source-tag is-" + s.type} title="Added by the app">
                  {SOURCE_TYPE_LABEL[s.type]}
                </span>
              )}
            </li>
          ))}
        </ol>
        {searchQueries.length > 0 && <div className="search-queries">Searched: {searchQueries.join(" · ")}</div>}
        <SearchSuggestions html={searchSuggestionsHtml} />
      </Exhibit>
    </>
  );
}
