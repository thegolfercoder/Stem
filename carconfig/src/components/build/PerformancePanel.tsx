"use client";

import type { ConfiguratorState } from "@/components/configurator/useConfigurator";
import { VerificationBadge } from "@/components/ui/badges";
import { PERFORMANCE_DISCLAIMER } from "@/lib/performance";
import { partFullName } from "@/types/part";

/**
 * The performance panel.
 *
 * Stock figures and estimates sit in the same row so the comparison is
 * immediate, and the estimate column is marked as estimated every time. The
 * disclaimer is not fine print at the bottom of the page — it is attached to
 * the numbers, because the numbers are the thing being over-trusted.
 */

function Row({
  label,
  stock,
  estimated,
  unit,
  changed,
}: {
  label: string;
  stock: number;
  estimated: number;
  unit: string;
  changed: boolean;
}) {
  const delta = estimated - stock;

  return (
    <tr className="border-t border-[var(--color-line)]">
      <th
        scope="row"
        className="py-2 pr-2 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-[var(--color-ink-faint)]"
      >
        {label}
      </th>
      <td className="numeric py-2 text-right text-[13px] text-[var(--color-ink-dim)]">
        {stock}
        <span className="ml-1 text-[10px] text-[var(--color-ink-faint)]">{unit}</span>
      </td>
      <td
        className={`numeric py-2 pl-3 text-right text-[14px] ${
          changed ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]"
        }`}
      >
        {estimated}
        <span className="ml-1 text-[10px] text-[var(--color-ink-faint)]">{unit}</span>
        {changed ? (
          <span
            className={`ml-2 text-[11px] ${
              delta > 0 ? "text-[var(--color-ok)]" : "text-[var(--color-warn)]"
            }`}
          >
            {delta > 0 ? "+" : "−"}
            {Math.abs(Math.round(delta * 10) / 10)}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function PerformancePanel({ state }: { state: ConfiguratorState }) {
  const p = state.performance;
  const modified =
    p.powerDeltaHp !== 0 || p.torqueDeltaNm !== 0 || p.weightDeltaKg !== 0;

  return (
    <section className="rounded border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-dim)]">
          Performance
        </h2>
        <VerificationBadge level="estimated" note={PERFORMANCE_DISCLAIMER} />
      </div>

      <div className="px-3 pb-3">
        <table className="w-full">
          <thead>
            <tr>
              <td />
              <th
                scope="col"
                className="pt-2 text-right text-[10px] font-normal uppercase tracking-[0.08em] text-[var(--color-ink-faint)]"
              >
                Stock
              </th>
              <th
                scope="col"
                className="pl-3 pt-2 text-right text-[10px] font-normal uppercase tracking-[0.08em] text-[var(--color-ink-faint)]"
              >
                Estimated
              </th>
            </tr>
          </thead>
          <tbody>
            <Row
              label="Power"
              stock={p.stockPowerHp}
              estimated={p.estimatedPowerHp}
              unit="hp"
              changed={p.powerDeltaHp !== 0}
            />
            <Row
              label="Torque"
              stock={p.stockTorqueNm}
              estimated={p.estimatedTorqueNm}
              unit="Nm"
              changed={p.torqueDeltaNm !== 0}
            />
            <Row
              label="Weight"
              stock={p.stockWeightKg}
              estimated={p.estimatedWeightKg}
              unit="kg"
              changed={p.weightDeltaKg !== 0}
            />
            <Row
              label="Power / weight"
              stock={p.stockPowerToWeight}
              estimated={p.estimatedPowerToWeight}
              unit="hp/t"
              changed={modified}
            />
          </tbody>
        </table>

        {p.discounted.length > 0 ? (
          <div className="mt-3 rounded border border-[var(--color-warn)]/25 bg-[var(--color-warn-bg)] px-2.5 py-2">
            <h3 className="text-[11px] font-medium text-[var(--color-warn)]">
              Claims not counted
            </h3>
            <ul className="mt-1 space-y-1">
              {p.discounted.map((d) => (
                <li key={d.part.id} className="text-[11px] leading-snug text-[var(--color-ink-dim)]">
                  <span className="text-[var(--color-ink)]">{partFullName(d.part)}</span>{" "}
                  — {d.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-3 text-[10px] leading-snug text-[var(--color-ink-faint)]">
          {PERFORMANCE_DISCLAIMER}
        </p>
      </div>
    </section>
  );
}
