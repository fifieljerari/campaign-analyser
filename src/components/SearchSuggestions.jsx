import { useEffect, useRef } from "react";

// Google's Search Suggestions, which the grounding terms require to be shown
// with every grounded answer, unmodified. Rendered inside a Shadow DOM, not
// an iframe: the terms forbid "framing" grounded content, and the shadow root
// keeps Google's CSS and ours from clashing (both define a .chip class).
// The HTML is inserted exactly as Google returns it; links behave as provided.
export default function SearchSuggestions({ html }) {
  const host = useRef(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !html) return;
    const root = el.shadowRoot || el.attachShadow({ mode: "open" });
    root.innerHTML = html;
  }, [html]);

  if (!html) return null;
  return <div className="search-suggestions" ref={host} aria-label="Google Search suggestions" />;
}
