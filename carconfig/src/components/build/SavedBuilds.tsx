"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  deleteBuild,
  duplicateBuild,
  getBuildsSnapshot,
  getServerBuildsSnapshot,
  subscribeBuilds,
} from "@/lib/build/storage";
import { formatCents } from "@/lib/pricing";
import type { CatalogVehicle } from "@/types/vehicle";
import { catalogVehicleName } from "@/types/vehicle";

/**
 * Saved builds.
 *
 * localStorage is subscribed to as an external store rather than copied into
 * component state. The server has no localStorage, so it renders the empty
 * state and React swaps in the real list on hydration — and because the list
 * is a subscription rather than a snapshot taken once, deleting or duplicating
 * a build updates the page without anything here having to re-read it.
 */

export function SavedBuilds({ vehicles }: { vehicles: readonly CatalogVehicle[] }) {
  const builds = useSyncExternalStore(
    subscribeBuilds,
    getBuildsSnapshot,
    getServerBuildsSnapshot,
  );

  const vehiclesByKey = new Map(vehicles.map((v) => [v.key, v]));

  if (builds.length === 0) {
    return (
      <div className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-8 text-center">
        <p className="text-[14px] text-[var(--color-ink-dim)]">
          No saved builds in this browser yet.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2 text-[13px] font-medium text-[#08101c] transition-opacity hover:opacity-90"
        >
          Pick a car
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {builds.map((build) => {
        const vehicle = vehiclesByKey.get(build.vehicleId);

        // Prices are snapshotted at save time, so the total shown here is what
        // the build cost when it was saved rather than what it would cost now.
        const total = build.parts.reduce(
          (sum, p) =>
            sum +
            ((p.priceCentsAtSave ?? 0) + (p.installCostCentsAtSave ?? 0)) *
              p.quantity,
          0,
        );

        return (
          <li
            key={build.id}
            className="flex flex-col rounded border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold tracking-tight">
                  {build.name}
                </h2>
                <p className="mt-0.5 truncate text-[12px] text-[var(--color-ink-dim)]">
                  {vehicle ? catalogVehicleName(vehicle) : build.vehicleId}
                </p>
              </div>
              {build.paintHex ? (
                <div
                  aria-hidden
                  className="mt-1 h-6 w-6 shrink-0 rounded-full border border-[var(--color-line-bright)]"
                  style={{ background: build.paintHex }}
                />
              ) : null}
            </div>

            <dl className="numeric mt-3 flex items-baseline justify-between border-t border-[var(--color-line)] pt-3 text-[13px]">
              <dt className="text-[var(--color-ink-faint)]">
                {build.parts.length} part{build.parts.length === 1 ? "" : "s"}
              </dt>
              <dd className="font-semibold">{formatCents(total)}</dd>
            </dl>

            <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
              Saved {new Date(build.updatedAt).toLocaleDateString()} · prices as at
              save
            </p>

            <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-line)] pt-3">
              <Link
                href={`/b/${build.shareCode}`}
                className="rounded border border-[var(--color-line-bright)] px-2.5 py-1 text-[12px] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
              >
                Open
              </Link>
              <button
                type="button"
                onClick={() => duplicateBuild(build.id)}
                className="rounded border border-[var(--color-line-bright)] px-2.5 py-1 text-[12px] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(`Delete "${build.name}"? This cannot be undone.`)
                  ) {
                    deleteBuild(build.id);
                  }
                }}
                className="ml-auto rounded px-2.5 py-1 text-[12px] text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-bad-bg)] hover:text-[var(--color-bad)]"
              >
                Delete
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
