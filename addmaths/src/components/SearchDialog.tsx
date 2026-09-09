"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

export interface SearchDoc {
  title: string;
  href: string;
  kind: string;
  section?: string;
  text: string;
}

let cache: SearchDoc[] | null = null;

/**
 * Site-wide search over a static index built at compile time
 * (`scripts/build-search-index.ts`). The index is fetched on first open rather
 * than shipped in the page bundle, so it costs nothing to a reader who never
 * searches.
 */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const [docs, setDocs] = useState<SearchDoc[] | null>(cache);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (cache) return;
    let alive = true;
    fetch("/search-index.json")
      .then((r) => r.json())
      .then((d: SearchDoc[]) => {
        cache = d;
        if (alive) setDocs(d);
      })
      .catch(() => setDocs([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const results = useMemo(() => search(docs ?? [], q), [docs, q]);

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      const hit = results[active];
      if (hit) {
        e.preventDefault();
        window.location.href = hit.href;
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[8vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search the site"
        onKeyDown={onKeyDown}
        className="card fade-up flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 border-b border-[color:var(--border)] px-4">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-60" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search topics, formulas, examples, terms…"
            aria-label="Search query"
            className="w-full bg-transparent py-4 text-[0.98rem] outline-none placeholder:text-[color:var(--text-muted)]"
          />
          <button
            type="button"
            onClick={onClose}
            className="muted rounded-md border border-[color:var(--border)] px-2 py-1 text-[11px]"
          >
            Esc
          </button>
        </div>

        <ul ref={listRef} className="overflow-y-auto p-2" role="listbox" aria-label="Search results">
          {docs === null && <li className="muted p-4 text-sm">Loading the index…</li>}
          {docs !== null && q.trim() === "" && (
            <li className="muted p-4 text-sm">
              Type to search across every topic, formula, worked example, exam
              question and glossary entry on the site.
            </li>
          )}
          {docs !== null && q.trim() !== "" && results.length === 0 && (
            <li className="muted p-4 text-sm">No matches for “{q}”.</li>
          )}
          {results.map((r, i) => (
            <li key={r.href + i} role="option" aria-selected={i === active} data-active={i === active}>
              <Link
                href={r.href}
                onClick={onClose}
                onMouseEnter={() => setActive(i)}
                className={`block rounded-lg px-3 py-2.5 ${
                  i === active ? "bg-[color:var(--accent-soft)]" : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{r.title}</span>
                  <span className="muted shrink-0 text-[11px] uppercase tracking-wide">{r.kind}</span>
                </div>
                <p className="muted mt-0.5 line-clamp-2 text-xs leading-relaxed">{r.text.slice(0, 170)}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Ranked substring search. Every term in the query must appear somewhere in
 * the document; matches in the title, and matches that start a word, score
 * higher than a match buried mid-body.
 */
export function search(docs: SearchDoc[], query: string, limit = 30): SearchDoc[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: { doc: SearchDoc; score: number }[] = [];
  for (const doc of docs) {
    const title = doc.title.toLowerCase();
    const body = doc.text.toLowerCase();
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const inTitle = title.indexOf(t);
      const inBody = body.indexOf(t);
      if (inTitle === -1 && inBody === -1) {
        ok = false;
        break;
      }
      if (inTitle !== -1) score += inTitle === 0 ? 14 : 9;
      if (inBody !== -1) score += 3;
      if (new RegExp(`\\b${escapeRe(t)}`).test(body)) score += 2;
    }
    if (ok) {
      if (title === query.toLowerCase()) score += 25;
      if (doc.kind === "Topic") score += 4;
      scored.push({ doc, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.doc);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
