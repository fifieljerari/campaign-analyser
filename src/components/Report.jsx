import SearchSuggestions from "./SearchSuggestions.jsx";

// The analysis, in the same lettered "Exhibit" layout as Market Entry Dossier.
// Live answers are only rendered after viewFor() has confirmed a complete,
// beauty, found, sourced analysis, and their text is shown exactly as Gemini
// returned it. Anything the app adds (tool checks, notes) sits in separate,
// labelled elements, never inside the model's sentences. Also renders the
// hand-written examples (example = true), which aren't grounded output.

const STAMP = { Success: "is-success", Mixed: "is-mixed", Failure: "is-failure" };

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

// Bullets with numbered source links taken from the grounding metadata's
// per-passage supports (the Links Google provides for citing). cites === null
// means the metadata had no supports, so nothing could be linked. Unlinked
// items are counted in a note below the list rather than labelled inline.
function CitedBullets({ items, cites, sources }) {
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

export default function Report({ r, searchQueries = [], searchSuggestionsHtml = "", example = false }) {
  const m = r.matchedCampaign;
  return (
    <>
      <div className="case-summary">
        Case File &middot; {m.brand} &middot; {m.name} &middot; {m.year}
      </div>

      <Exhibit letter="A" title="Context">
        <p>{r.context}</p>
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
            <CitedBullets items={r.results.items} cites={r.citations?.results ?? null} sources={r.sources} />
            <p className="cite-note">Figures are as reported by the linked sources. Check the scope (product, market, period) before reusing one.</p>
          </>
        ) : (
          <p className="empty-line">No public results found. The brand doesn&rsquo;t appear to have published measurable outcomes for this campaign.</p>
        )}
      </Exhibit>

      <Exhibit letter="E" title="Reception">
        <h4>Praise</h4>
        <Bullets items={r.reception.praise} empty="No notable praise found." />
        <h4>Criticism</h4>
        <Bullets items={r.reception.criticism} empty="No notable criticism found." />
        <h4>Backlash</h4>
        <p className={r.reception.backlash ? "" : "empty-line"}>{r.reception.backlash || "No backlash found."}</p>
      </Exhibit>

      <Exhibit letter="F" title="Verdict">
        <div className={"stamp " + STAMP[r.verdict.rating]}>{r.verdict.rating}</div>
        <div className="confidence-line">
          Confidence: <strong>{r.confidence}</strong>
        </div>
        <p className="empty-line">{r.confidenceReason}</p>
        {!example && r.sourceCoverage && (
          <div className={"tool-check" + (r.confidenceExceedsSources ? " is-warn" : "")}>
            <span className="tool-check-label">Tool check</span>
            The search returned {r.sources.length} {r.sources.length === 1 ? "source" : "sources"}, which supports{" "}
            <strong>{r.sourceCoverage}</strong> confidence at most.
            {r.confidenceExceedsSources && " The rating above claims more certainty than that, so treat it with caution."}
          </div>
        )}
        {r.verdict.split.length > 0 && (
          <>
            <h4>Split verdict</h4>
            {r.verdict.split.map((s, i) => (
              <div className="split-row" key={i}>
                <span className={"stamp small " + STAMP[s.rating]}>{s.rating}</span>
                <div>
                  <div className="split-dim">{s.dimension}</div>
                  <div className="split-note">{s.note}</div>
                </div>
              </div>
            ))}
          </>
        )}
        <h4>Evidence (from sources)</h4>
        <CitedBullets items={r.verdict.evidence} cites={r.citations?.evidence ?? null} sources={r.sources} />
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
            : "Taken from the search tool\u2019s own records of what it read, not from links the model wrote."}
        </p>
        <ol className="source-list">
          {r.sources.map((s, i) => (
            <li key={i}>
              <a href={s.uri} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
        {searchQueries.length > 0 && <div className="search-queries">Searched: {searchQueries.join(" · ")}</div>}
        <SearchSuggestions html={searchSuggestionsHtml} />
      </Exhibit>
    </>
  );
}
