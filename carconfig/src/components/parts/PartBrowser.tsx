"use client";

import { useMemo, useState } from "react";
import { FindingList } from "@/components/compatibility/FindingList";
import { StatusBadge, VerificationBadge } from "@/components/ui/badges";
import type { ConfiguratorState } from "@/components/configurator/useConfigurator";
import { formatCents } from "@/lib/pricing";
import type { CompatibilityResult } from "@/types/compatibility";
import type { Part, PartCategorySlug } from "@/types/part";
import { PART_CATEGORIES, partFullName } from "@/types/part";
import { specSummary } from "./spec-summary";

/**
 * The part list.
 *
 * Every row carries its verdict before it is chosen, not after. That ordering
 * is the product: a configurator that lets you add a wheel and then tells you
 * it does not fit has made you do the work, and the only reason to hold a
 * compatibility database is to answer the question at the moment it is asked.
 *
 * Incompatible parts are shown rather than hidden, greyed and explained. The
 * question "why can't I have that one" deserves an answer.
 */

export function PartBrowser({ state }: { state: ConfiguratorState }) {
  const [category, setCategory] = useState<PartCategorySlug>("wheels");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const selectedCategory = PART_CATEGORIES.find((c) => c.slug === category);

  const parts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return state.catalogue.filter((p) => {
      if (p.category !== category) return false;
      if (!needle) return true;
      return `${p.brand} ${p.name} ${p.description}`.toLowerCase().includes(needle);
    });
  }, [state.catalogue, category, search]);

  /**
   * Evaluated once per render for the visible category only. Evaluating the
   * whole catalogue on every keystroke would be wasteful for no benefit.
   */
  const evaluated = useMemo(
    () => parts.map((part) => ({ part, result: state.evaluate(part) })),
    [parts, state],
  );

  const counts = useMemo(() => {
    const byCategory = new Map<PartCategorySlug, number>();
    for (const part of state.catalogue) {
      byCategory.set(part.category, (byCategory.get(part.category) ?? 0) + 1);
    }
    return byCategory;
  }, [state.catalogue]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--color-line)] px-4 pb-3 pt-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-dim)]">
          Parts
        </h2>

        <div
          className="mt-3 flex gap-1 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Part categories"
        >
          {PART_CATEGORIES.map((c) => {
            const count = counts.get(c.slug) ?? 0;
            const chosen = state.selectedParts.some((p) => p.category === c.slug);

            return (
              <button
                key={c.slug}
                role="tab"
                aria-selected={category === c.slug}
                type="button"
                disabled={count === 0}
                onClick={() => {
                  setCategory(c.slug);
                  setExpanded(null);
                }}
                className={`relative shrink-0 rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                  category === c.slug
                    ? "bg-[var(--color-accent-dim)] text-[var(--color-ink)]"
                    : "text-[var(--color-ink-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                }`}
              >
                {c.name}
                {chosen ? (
                  <span
                    aria-label="selected"
                    className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] align-middle"
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {selectedCategory ? (
          <p className="mt-2 text-[11px] leading-snug text-[var(--color-ink-faint)]">
            {selectedCategory.description}
            {!selectedCategory.singleSelect ? " Multiple can be added." : null}
          </p>
        ) : null}

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${selectedCategory?.name.toLowerCase() ?? "parts"}`}
          aria-label="Search parts"
          className="mt-3 w-full rounded border border-[var(--color-line)] bg-[var(--color-base)] px-2.5 py-1.5 text-[13px] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {evaluated.length === 0 ? (
          <p className="p-4 text-[13px] text-[var(--color-ink-dim)]">
            No parts in this category yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {evaluated.map(({ part, result }) => (
              <PartRow
                key={part.id}
                part={part}
                result={result}
                selected={state.isSelected(part.id)}
                expanded={expanded === part.id}
                onToggleExpand={() =>
                  setExpanded((cur) => (cur === part.id ? null : part.id))
                }
                onToggle={() => state.toggle(part)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PartRow({
  part,
  result,
  selected,
  expanded,
  onToggle,
  onToggleExpand,
}: {
  part: Part;
  result: CompatibilityResult;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onToggleExpand: () => void;
}) {
  const blocked = result.status === "incompatible";

  return (
    <li
      className={`px-4 py-3 transition-colors ${
        selected ? "bg-[var(--color-accent-dim)]/20" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`min-w-0 flex-1 ${blocked ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-medium text-[var(--color-ink)]">
              {partFullName(part)}
            </span>
            <StatusBadge status={result.status} />
          </div>

          <p className="numeric mt-1 text-[11px] text-[var(--color-ink-dim)]">
            {specSummary(part)}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="numeric text-[var(--color-ink)]">
              {part.price ? formatCents(part.price.cents) : "No price on record"}
            </span>
            {part.installCost && part.installCost.cents > 0 ? (
              <span className="numeric text-[var(--color-ink-faint)]">
                + {formatCents(part.installCost.cents)} fitting
              </span>
            ) : null}
            <VerificationBadge
              level={part.priceProvenance.verification}
              note={part.priceProvenance.note}
            />
          </div>

          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            className="mt-2 text-[11px] text-[var(--color-accent)] hover:underline"
          >
            {expanded ? "Hide" : "Why"} — {result.findings.length} check
            {result.findings.length === 1 ? "" : "s"}
          </button>
        </div>

        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          className={`shrink-0 rounded border px-3 py-1.5 text-[12px] font-medium transition-colors ${
            selected
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[#08101c] hover:opacity-90"
              : "border-[var(--color-line-bright)] text-[var(--color-ink-dim)] hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
          }`}
        >
          {selected ? "Remove" : "Add"}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-base)] px-3 py-1">
          <FindingList result={result} />
        </div>
      ) : null}
    </li>
  );
}
