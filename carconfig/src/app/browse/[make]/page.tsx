import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog } from "@/lib/catalog";
import { modelHasProfile } from "@/lib/catalog/identities";

interface RouteParams {
  params: Promise<{ make: string }>;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { make } = await params;
  const makes = await getCatalog().listMakes();
  const found = makes.find((m) => m.slug === make);
  return { title: found ? `${found.name} models` : "Make not found" };
}

export default async function MakePage({ params }: RouteParams) {
  const { make } = await params;
  const catalog = getCatalog();

  const [makes, models] = await Promise.all([
    catalog.listMakes(),
    catalog.listModels(make),
  ]);

  const summary = makes.find((m) => m.slug === make);
  if (!summary || models.length === 0) notFound();

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <Link
        href="/"
        className="text-[12px] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
      >
        ← All makes
      </Link>

      <h1 className="mt-3 text-[26px] font-semibold tracking-tight">{summary.name}</h1>
      <p className="mt-1.5 text-[13px] text-[var(--color-ink-dim)]">
        {models.length} model {models.length === 1 ? "line" : "lines"}
      </p>

      <ul className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {models.map((model) => {
          const measured = modelHasProfile(model.makeSlug, model.modelSlug);
          return (
            <li key={model.modelSlug}>
              <Link
                href={`/browse/${model.makeSlug}/${model.modelSlug}`}
                className="flex items-center justify-between gap-3 rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 transition-colors hover:border-[var(--color-accent)]"
              >
                <span className="min-w-0">
                  <span className="text-[14px] text-[var(--color-ink)]">
                    {model.model}
                  </span>
                  <span className="numeric ml-2 text-[12px] text-[var(--color-ink-faint)]">
                    {model.years[0]}–{model.years[model.years.length - 1]}
                  </span>
                </span>
                {measured ? (
                  <span className="shrink-0 rounded border border-[var(--color-ok)]/30 bg-[var(--color-ok-bg)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-ok)]">
                    Measured
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
