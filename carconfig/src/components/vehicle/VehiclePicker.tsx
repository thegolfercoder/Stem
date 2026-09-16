"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { VerificationBadge } from "@/components/ui/badges";
import type { Vehicle } from "@/types/vehicle";
import {
  DRIVETRAIN_LABELS,
  boltPatternLabel,
  tireSizeLabel,
  wheelSizeLabel,
} from "@/types/vehicle";

/**
 * Vehicle selection.
 *
 * Fifteen cars is few enough that filtering beats paging: a search box and a
 * drivetrain filter get anybody to their car in one or two keystrokes, and
 * neither needs a round trip. When this list is thousands of cars it becomes a
 * server-side query — the filter shape below is already the shape of that
 * query's parameters.
 */

type DrivetrainFilter = "all" | "rwd" | "awd" | "fwd";

const FILTERS: readonly { value: DrivetrainFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "rwd", label: "RWD" },
  { value: "awd", label: "AWD" },
  { value: "fwd", label: "FWD" },
];

export function VehiclePicker({ vehicles }: { vehicles: readonly Vehicle[] }) {
  const [query, setQuery] = useState("");
  const [drivetrain, setDrivetrain] = useState<DrivetrainFilter>("all");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (drivetrain !== "all" && v.drivetrain !== drivetrain) return false;
      if (!needle) return true;
      return (
        `${v.manufacturer} ${v.model} ${v.trim} ${v.generationCode} ${v.engine.code}`
          .toLowerCase()
          .includes(needle)
      );
    });
  }, [vehicles, query, drivetrain]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by make, model, generation or engine code"
            aria-label="Search vehicles"
            className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[14px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setDrivetrain(f.value)}
              className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${
                drivetrain === f.value
                  ? "bg-[var(--color-accent-dim)] text-[var(--color-ink)]"
                  : "text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 text-[12px] text-[var(--color-ink-faint)]">
        {filtered.length} of {vehicles.length} vehicles
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((vehicle) => (
          <li key={vehicle.id}>
            <VehicleCard vehicle={vehicle} />
          </li>
        ))}
      </ul>

      {filtered.length === 0 ? (
        <p className="mt-10 text-center text-[14px] text-[var(--color-ink-dim)]">
          Nothing matches that. The catalogue is fifteen cars — see{" "}
          <Link href="/data" className="text-[var(--color-accent)] hover:underline">
            data quality
          </Link>{" "}
          for why it is deliberately small.
        </p>
      ) : null}
    </div>
  );
}

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const front = vehicle.wheels.front;
  const rear = vehicle.wheels.rear;
  const staggered = vehicle.traits.includes("staggered_stock_fitment");

  return (
    <Link
      href={`/configure/${vehicle.slug}`}
      className="group block h-full rounded border border-[var(--color-line)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-line-bright)] hover:bg-[var(--color-surface-2)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
            {vehicle.manufacturer}
          </div>
          <h3 className="mt-0.5 truncate text-[16px] font-semibold tracking-tight text-[var(--color-ink)]">
            {vehicle.model}
          </h3>
          <div className="mt-0.5 truncate text-[12px] text-[var(--color-ink-dim)]">
            {vehicle.year} {vehicle.trim} · {vehicle.generationCode}
          </div>
        </div>
        <div
          aria-hidden
          className="mt-1 h-7 w-7 shrink-0 rounded-full border border-[var(--color-line-bright)]"
          style={{ background: vehicle.defaultPaintHex }}
        />
      </div>

      <dl className="numeric mt-4 grid grid-cols-3 gap-2 border-t border-[var(--color-line)] pt-3 text-[13px]">
        <div>
          <dt className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
            Power
          </dt>
          <dd>
            {vehicle.stockPowerHp}
            <span className="ml-0.5 text-[10px] text-[var(--color-ink-faint)]">hp</span>
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
            Torque
          </dt>
          <dd>
            {vehicle.stockTorqueNm}
            <span className="ml-0.5 text-[10px] text-[var(--color-ink-faint)]">Nm</span>
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
            Weight
          </dt>
          <dd>
            {vehicle.stockWeightKg}
            <span className="ml-0.5 text-[10px] text-[var(--color-ink-faint)]">kg</span>
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-1 text-[11px] text-[var(--color-ink-dim)]">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-ink-faint)]">Drive</span>
          <span>{DRIVETRAIN_LABELS[vehicle.drivetrain]}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-ink-faint)]">Bolts</span>
          <span className="numeric">{boltPatternLabel(front)}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-[var(--color-ink-faint)]">Wheels</span>
          <span className="numeric">
            {wheelSizeLabel(front)} · {tireSizeLabel(front.tire)}
            {staggered ? (
              <>
                <br />
                {wheelSizeLabel(rear)} · {tireSizeLabel(rear.tire)}
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--color-line)] pt-3">
        <VerificationBadge
          level={vehicle.provenance.verification}
          note={vehicle.provenance.note}
        />
        <span className="text-[12px] text-[var(--color-ink-dim)] transition-colors group-hover:text-[var(--color-accent)]">
          Configure →
        </span>
      </div>
    </Link>
  );
}
