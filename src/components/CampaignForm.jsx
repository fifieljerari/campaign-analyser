import { useState } from "react";
import { validateInput } from "../lib/analysis.js";
import { CAP_MAX } from "../lib/dailyCap.js";

export default function CampaignForm({ form, setForm, onSubmit, remaining, detailRef }) {
  const [error, setError] = useState(false);
  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const thisYear = new Date().getFullYear();
  const capped = remaining <= 0;

  function handleSubmit(e) {
    e.preventDefault();
    if (capped) return;
    if (!validateInput(form).ok) {
      setError(true);
      return;
    }
    setError(false);
    onSubmit();
  }

  return (
    <section className="card form-card">
      <div className="form-eyebrow">Case Request Form</div>
      <h2>Open a Campaign File</h2>
      <p className="form-sub">
        Name a beauty campaign. It gets researched live on Google Search, then judged: what happened, how it landed,
        and whether it worked for the brand. Only claims the search turned up are used, with the sources listed.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="brand">Brand</label>
            <input type="text" id="brand" placeholder="e.g. Dove" maxLength={80} value={form.brand} onChange={update("brand")} />
          </div>
          <div className="field">
            <label htmlFor="year">Year Launched</label>
            <input type="number" id="year" placeholder="e.g. 2004" min="1900" max={thisYear} step="1" value={form.year} onChange={update("year")} />
          </div>
          <div className="field span-2">
            <label htmlFor="campaign">Campaign Name</label>
            <input type="text" id="campaign" placeholder="e.g. Campaign for Real Beauty" maxLength={120} value={form.campaign} onChange={update("campaign")} />
          </div>
          <div className="field span-2">
            <label htmlFor="detail">
              Product or Market <span className="optional">(optional)</span>
            </label>
            <input type="text" id="detail" ref={detailRef} placeholder="e.g. body wash, UK" maxLength={160} value={form.detail} onChange={update("detail")} />
            <div className="field-note">Helps when a brand ran several campaigns with similar names that year.</div>
          </div>
        </div>

        <button type="submit" className="submit" disabled={capped}>
          Research &amp; Analyse
        </button>
        {error && <div className="form-error">Please add a brand, a campaign name, and a year between 1900 and {thisYear}.</div>}
        {capped ? (
          <div className="rate-limit-msg">
            Free daily quota reached &mdash; back tomorrow! Meanwhile, see the <a href="#examples">example analyses</a> below.
          </div>
        ) : (
          <div className="quota-note">
            {remaining} of {CAP_MAX} analyses remaining today (this browser).
          </div>
        )}
      </form>
    </section>
  );
}
