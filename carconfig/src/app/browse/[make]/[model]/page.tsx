import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog } from "@/lib/catalog";
import { findProfile } from "@/lib/catalog/identities";
import { BODY_TYPE_LABELS } from "@/types/vehicle";

interface RouteParams {
  params: Promise<{ make: string; model: string }>;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { make, model } = await params;
  const line = await getCatalog().getModelLine(make, model);
  return { title: line ? `${line.make} ${line.model} — pick a year` : "Model not found" };
}

/**
 * Year selection.
 *
 * Years that have a fitment profile are marked, because which year you pick
 * genuinely changes what the configurator can tell you: a 2023 M3 is measured
 * and a 2004 one is not.
 */
export default async function ModelPage({ params }: RouteParams) {
  const { make, model } = await params;
  const line = await getCatalog().getModelLine(make, model);
  if (!line) notFound();

  const years = [...line.years].sort((a, b) => b - a);
  const measuredYears = new Set(
    years.filter((y) => findProfile(make, model, y) !== null),
  );

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <Link
        href={`/browse/${line.makeSlug}`}
        className="text-[12px] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
      >
        ← {line.make}
      </Link>

      <h1 className="mt-3 text-[26px] font-semibold tracking-tight">
        {line.make} {line.model}
      </h1>
      <p className="mt-1.5 text-[13px] text-[var(--color-ink-dim)]">
        {years.length} model {years.length === 1 ? "year" : "years"} ·{" "}
        {line.types.map((t) => BODY_TYPE_LABELS[t]).join(", ")}
        {measuredYears.size > 0 ? (
          <>
            {" · "}
            <span className="text-[var(--color-ok)]">
              {measuredYears.size} with fitment data
            </span>
          </>
        ) : null}
      </p>

      {measuredYears.size === 0 ? (
        <p className="mt-4 max-w-2xl rounded border border-[var(--color-unknown)]/30 bg-[var(--color-unknown-bg)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
          No year of this car has been measured yet. You can still open and cost
          a build — the compatibility engine will report every fitment check as
          unknown rather than guessing at it.
        </p>
      ) : null}

      <ul className="mt-6 flex flex-wrap gap-2">
        {years.map((year) => {
          const measured = measuredYears.has(year);
          return (
            <li key={year}>
              <Link
                href={`/configure/${line.makeSlug}/${line.modelSlug}/${year}`}
                className={`numeric inline-block rounded border px-3.5 py-2 text-[14px] transition-colors ${
                  measured
                    ? "border-[var(--color-ok)]/40 bg-[var(--color-ok-bg)] text-[var(--color-ok)] hover:border-[var(--color-ok)]"
                    : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-dim)] hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
                }`}
              >
                {year}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
