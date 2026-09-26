"use client";

import type { ConfiguratorState } from "@/components/configurator/useConfigurator";
import { claimSummary } from "@/components/parts/spec-summary";
import { StatusBadge, VerificationBadge } from "@/components/ui/badges";
import { formatCents } from "@/lib/pricing";
import { PART_CATEGORIES, partFullName } from "@/types/part";
import { STATUS_LABELS } from "@/types/compatibility";

/**
 * The build summary.
 *
 * Part cost and installation cost are separate lines all the way to the
 * bottom. Installation is the number people forget, and on a brake kit it is
 * a fifth of the price — folding it into a single total would make the
 * cheaper-looking option the wrong answer.
 */

export function BuildSummary({ state }: { state: ConfiguratorState }) {
  const { cost, selectedParts, selectedResults, buildStatus } = state;

  const grouped = PART_CATEGORIES.map((category) => ({
    category,
    parts: selectedParts.filter((p) => p.category === category.slug),
  })).filter((g) => g.parts.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--color-line)] px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-dim)]">
            Build
          </h2>
          {selectedParts.length > 0 ? (
            <StatusBadge
              status={buildStatus}
              size="md"
              label={
                buildStatus === "compatible"
                  ? "All checks pass"
                  : STATUS_LABELS[buildStatus]
              }
            />
          ) : null}
        </div>

        <input
          value={state.name}
          onChange={(e) => state.setName(e.target.value.slice(0, 80))}
          aria-label="Build name"
          className="mt-3 w-full rounded border border-transparent bg-transparent px-0 py-1 text-[16px] font-semibold tracking-tight text-[var(--color-ink)] hover:border-[var(--color-line)] focus:border-[var(--color-accent)] focus:px-2 focus:outline-none"
        />
        <p className="text-[12px] text-[var(--color-ink-dim)]">
          {state.vehicle.year} {state.vehicle.make} {state.vehicle.model}
          {state.vehicle.profile ? ` · ${state.vehicle.profile.trim}` : null}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {selectedParts.length === 0 ? (
          <p className="py-6 text-[13px] leading-relaxed text-[var(--color-ink-dim)]">
            Nothing added yet. Every part you add is checked against this car&apos;s
            own measurements and against the rest of the build.
          </p>
        ) : (
          <div className="py-3">
            {grouped.map(({ category, parts }) => (
              <section key={category.slug} className="mb-4 last:mb-0">
                <h3 className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                  {category.name}
                </h3>

                <ul className="mt-1.5 space-y-2">
                  {parts.map((part) => {
                    const result = selectedResults.get(part.id);
                    const claim = claimSummary(part);

                    return (
                      <li
                        key={part.id}
                        className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-[var(--color-ink)]">
                              {partFullName(part)}
                            </div>
                            {claim ? (
                              <div className="numeric mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
                                {claim}
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => state.remove(part.id)}
                            aria-label={`Remove ${partFullName(part)}`}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[15px] leading-none text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-bad-bg)] hover:text-[var(--color-bad)]"
                          >
                            ×
                          </button>
                        </div>

                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          {result ? <StatusBadge status={result.status} /> : <span />}
                          <div className="numeric text-right text-[11px]">
                            <div className="text-[var(--color-ink)]">
                              {part.price ? formatCents(part.price.cents) : "—"}
                            </div>
                            {part.installCost && part.installCost.cents > 0 ? (
                              <div className="text-[var(--color-ink-faint)]">
                                + {formatCents(part.installCost.cents)} fit
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-line)] px-4 py-3">
        <dl className="numeric space-y-1.5 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-[var(--color-ink-dim)]">Part cost</dt>
            <dd>{formatCents(cost.partsCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-ink-dim)]">Installation</dt>
            <dd>{formatCents(cost.installCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-[var(--color-line)] pt-2 text-[17px] font-semibold">
            <dt>Total</dt>
            <dd>{formatCents(cost.totalCents)}</dd>
          </div>
        </dl>

        <div className="mt-2.5 flex items-start gap-2">
          <VerificationBadge level={cost.confidence} />
          <p className="text-[10px] leading-snug text-[var(--color-ink-faint)]">
            Prices are invented placeholders for development. They are not quotes
            and are not connected to any retailer.
          </p>
        </div>

        {cost.missingPriceCount > 0 ? (
          <p className="mt-2 text-[11px] text-[var(--color-warn)]">
            {cost.missingPriceCount} part
            {cost.missingPriceCount === 1 ? " has" : "s have"} no price on record and
            {cost.missingPriceCount === 1 ? " is" : " are"} not in this total.
          </p>
        ) : null}
      </div>
    </div>
  );
}
