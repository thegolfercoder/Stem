"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Search across the whole catalogue.
 *
 * Queries the server rather than filtering a bundled list, because the
 * catalogue is a few hundred kilobytes of identities and has no business in
 * the browser bundle. Requests are debounced and the in-flight one is aborted
 * when the query moves on, so typing quickly does not queue up work.
 */

interface Hit {
  makeSlug: string;
  make: string;
  modelSlug: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  hasProfile: boolean;
}

export function VehicleSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  // Results remember which query they answer, so "still searching" is derived
  // rather than stored: nothing has to be reset synchronously when typing.
  const [result, setResult] = useState<{ q: string; hits: Hit[] }>({ q: "", hits: [] });

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/vehicles/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results: Hit[] };
        setResult({ q, hits: body.results });
      } catch (err) {
        // An aborted request is the expected case while typing, not a failure.
        if ((err as Error).name !== "AbortError") setResult({ q, hits: [] });
      }
    }, 160);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const trimmed = query.trim();
  const busy = trimmed.length >= 2 && result.q !== trimmed;
  const hits = result.q === trimmed ? result.hits : [];

  return (
    <div className="relative">
      <input
        type="search"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search 1,100+ model lines — try 'M3', 'Civic', 'Supra'"
        aria-label="Search vehicles"
        className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[15px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none"
      />

      {query.trim().length >= 2 ? (
        <div className="mt-2 overflow-hidden rounded border border-[var(--color-line)] bg-[var(--color-surface)]">
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-[var(--color-ink-dim)]">
              {busy ? "Searching…" : "Nothing matches that."}
            </p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {hits.map((h) => (
                <li key={`${h.makeSlug}/${h.modelSlug}`}>
                  <Link
                    href={`/browse/${h.makeSlug}/${h.modelSlug}`}
                    className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-2)]"
                  >
                    <span className="min-w-0">
                      <span className="text-[14px] text-[var(--color-ink)]">
                        {h.make} {h.model}
                      </span>
                      <span className="numeric ml-2 text-[12px] text-[var(--color-ink-faint)]">
                        {h.yearFrom}–{h.yearTo}
                      </span>
                    </span>
                    {h.hasProfile ? (
                      <span className="shrink-0 rounded border border-[var(--color-ok)]/30 bg-[var(--color-ok-bg)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-ok)]">
                        Measured
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
