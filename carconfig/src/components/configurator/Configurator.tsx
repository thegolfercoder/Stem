"use client";

import Link from "next/link";
import { useState } from "react";
import { BuildSummary } from "@/components/build/BuildSummary";
import { PerformancePanel } from "@/components/build/PerformancePanel";
import { PartBrowser } from "@/components/parts/PartBrowser";
import { ViewerPanel } from "@/components/three/ViewerPanel";
import type { ModelInfo } from "@/components/three/car/RealCar";
import { VerificationBadge } from "@/components/ui/badges";
import { encodeShareCode, generateId } from "@/lib/build/share";
import { saveBuild } from "@/lib/build/storage";
import { formatCents } from "@/lib/pricing";
import type { Build } from "@/types/build";
import type { FitmentRecord, Part } from "@/types/part";
import type { CatalogVehicle } from "@/types/vehicle";
import {
  DRIVETRAIN_LABELS,
  boltPatternLabel,
  tireSizeLabel,
  wheelSizeLabel,
} from "@/types/vehicle";
import { CATALOG_STATS } from "@/lib/catalog/identities";
import { CustomisePanel } from "./CustomisePanel";
import { useConfigurator, type ConfiguratorInit } from "./useConfigurator";

/**
 * The configurator screen.
 *
 * The car is the page: the viewer takes most of the width at nearly the full
 * height, the way a manufacturer's configurator does, and every control sits
 * in one panel beside it (customise, parts, build), so nothing that changes
 * the car ever pushes the car off screen. Saving and sharing stay pinned at
 * the panel's foot. The spec and performance cards sit under the car.
 *
 * Below a large screen it stacks: car, then the panel.
 */

export function Configurator({
  vehicle,
  catalogue,
  fitmentRecords,
  init,
}: {
  vehicle: CatalogVehicle;
  catalogue: readonly Part[];
  fitmentRecords: readonly FitmentRecord[];
  init?: ConfiguratorInit;
}) {
  const state = useConfigurator(vehicle, catalogue, fitmentRecords, init);
  // What the loaded 3D model turned out to allow (repaint, wheels), so the
  // panel can say when a choice will not show on this particular model.
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);

  return (
    <div className="mx-auto max-w-[1920px] px-3 py-3 sm:px-4">
      <VehicleHeader vehicle={vehicle} />

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(360px,410px)] lg:items-start">
        <section className="space-y-3">
          <div className="h-[380px] sm:h-[500px] lg:h-[calc(100vh-132px)] lg:min-h-[520px]">
            <ViewerPanel config={state.viewerConfig} onModelInfo={setModelInfo} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PerformancePanel state={state} />
            <StockSpecPanel vehicle={vehicle} />
          </div>
        </section>

        <section className="flex h-[680px] flex-col overflow-hidden rounded border border-[var(--color-line)] bg-[var(--color-surface)] lg:sticky lg:top-3 lg:h-[calc(100vh-132px)] lg:min-h-[520px]">
          <SideTabs state={state} modelInfo={modelInfo} />
          <SaveShareBar state={state} />
        </section>
      </div>
    </div>
  );
}

function VehicleHeader({ vehicle }: { vehicle: CatalogVehicle }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Link
        href="/"
        className="text-[12px] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
      >
        ← Vehicles
      </Link>

      <h1 className="text-[18px] font-semibold tracking-tight">
        {vehicle.year} {vehicle.make} {vehicle.model}
        {vehicle.profile ? (
          <span className="ml-2 text-[13px] font-normal text-[var(--color-ink-dim)]">
            {vehicle.profile.trim} · {vehicle.profile.generationCode} ·{" "}
            {vehicle.profile.engine.code}
          </span>
        ) : null}
      </h1>

      <div className="ml-auto">
        {vehicle.profile ? (
          <VerificationBadge
            level={vehicle.profile.provenance.verification}
            note={vehicle.profile.provenance.note}
          />
        ) : (
          <span className="rounded border border-[var(--color-unknown)]/30 bg-[var(--color-unknown-bg)] px-2 py-1 text-[11px] font-medium text-[var(--color-unknown)]">
            No fitment data for this car yet
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Customise first: how the car looks is what most people come to change.
 * The parts catalogue (fitment, prices, verdicts) and the build itself are a
 * tab away.
 */
function SideTabs({ state, modelInfo }: { state: ReturnType<typeof useConfigurator>; modelInfo: ModelInfo | null }) {
  const [tab, setTab] = useState<"look" | "parts" | "build">("look");
  const count = state.selectedParts.length;
  return (
    <>
      <div role="tablist" aria-label="Build panels" className="flex shrink-0 border-b border-[var(--color-line)]">
        {(
          [
            ["look", "Customise"],
            ["parts", "Parts"],
            ["build", `Build${count ? ` · ${count}` : ""}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 px-3 py-2.5 text-[12px] font-medium transition-colors ${
              tab === key
                ? "border-b-2 border-[var(--color-accent)] text-[var(--color-ink)]"
                : "text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "look" ? (
          <CustomisePanel state={state} modelInfo={modelInfo} />
        ) : tab === "parts" ? (
          <PartBrowser state={state} />
        ) : (
          <BuildSummary state={state} />
        )}
      </div>
    </>
  );
}

function StockSpecPanel({ vehicle }: { vehicle: CatalogVehicle }) {
  const profile = vehicle.profile;

  // The honest empty state. This is most of the catalogue, and the product's
  // whole argument is that saying so beats inventing a spec sheet.
  if (!profile) {
    return (
      <section className="rounded border border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2.5">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-dim)]">
            Factory specification
          </h2>
        </div>
        <div className="px-3 py-4">
          <p className="text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
            Nobody has recorded this car&apos;s bolt pattern, hub bore, wheel
            sizes or brake dimensions yet, so every fitment check comes back
            unknown. That is the truth about this car in this database, not a
            loading state.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            The catalogue lists {CATALOG_STATS.modelLines.toLocaleString()} model
            lines and {CATALOG_STATS.profiled} of them are measured. Measuring
            one car is a afternoon with a tape measure and a fitment guide;
            measuring all of them is the work this product exists to do.
          </p>
        </div>
      </section>
    );
  }

  const front = profile.wheels.front;
  const rear = profile.wheels.rear;
  const staggered = profile.traits.includes("staggered_stock_fitment");

  const rows: readonly (readonly [string, string])[] = [
    ["Engine", `${profile.engine.displayName} (${profile.engine.code})`],
    ["Drivetrain", DRIVETRAIN_LABELS[profile.drivetrain]],
    ["Bolt pattern", boltPatternLabel(front)],
    ["Hub bore", `${front.centerBoreMm}mm`],
    [
      "Stock wheels",
      staggered
        ? `${wheelSizeLabel(front)} / ${wheelSizeLabel(rear)}`
        : wheelSizeLabel(front),
    ],
    [
      "Stock tires",
      staggered
        ? `${tireSizeLabel(front.tire)} / ${tireSizeLabel(rear.tire)}`
        : tireSizeLabel(front.tire),
    ],
    [
      "Brakes",
      `${profile.brakes.front.rotorDiameterMm}mm front / ${profile.brakes.rear.rotorDiameterMm}mm rear`,
    ],
  ];

  return (
    <section className="rounded border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-dim)]">
          Factory specification
        </h2>
        <VerificationBadge
          level={profile.provenance.verification}
          note={profile.provenance.note}
        />
      </div>

      <dl className="px-3 py-1">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-3 border-t border-[var(--color-line)] py-1.5 first:border-t-0"
          >
            <dt className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
              {label}
            </dt>
            <dd className="numeric text-right text-[12px] text-[var(--color-ink)]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SaveShareBar({ state }: { state: ReturnType<typeof useConfigurator> }) {
  const [message, setMessage] = useState<string | null>(null);

  const shareCode = () =>
    encodeShareCode({
      vehicleKey: state.vehicle.key,
      name: state.name,
      parts: state.selectedParts.map((p) => ({ slug: p.slug, quantity: 1 })),
      // Only a chosen colour: an unchosen one would repaint a model that
      // should keep its own paint when the link is opened.
      paintHex: state.viewerConfig.paintChosen ? state.viewerConfig.paintHex : undefined,
      appearance: state.appearance,
    });

  const onSave = () => {
    const now = new Date().toISOString();
    const build: Build = {
      id: generateId(),
      shareCode: shareCode(),
      name: state.name,
      vehicleId: state.vehicle.key,
      parts: state.selectedParts.map((p) => ({
        partId: p.id,
        quantity: 1,
        // Snapshot the price, so re-opening this build next year shows what
        // it cost when it was saved rather than silently repricing it.
        priceCentsAtSave: p.price?.cents,
        installCostCentsAtSave: p.installCost?.cents,
      })),
      paintHex: state.viewerConfig.paintChosen ? state.viewerConfig.paintHex : undefined,
      appearance: state.appearance,
      createdAt: now,
      updatedAt: now,
      ownerId: null,
    };

    saveBuild(build);
    setMessage("Saved to this browser");
    window.setTimeout(() => setMessage(null), 2600);
  };

  const onShare = async () => {
    const url = `${window.location.origin}/b/${shareCode()}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied");
    } catch {
      // Clipboard access is denied in some browsers and over plain http.
      // Falling back to showing the link beats failing silently.
      window.prompt("Copy this link:", url);
      setMessage(null);
    }
    window.setTimeout(() => setMessage(null), 2600);
  };

  return (
    <div className="border-t border-[var(--color-line)] px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between text-[12px]">
        <span className="text-[var(--color-ink-dim)]">
          {state.selectedParts.length
            ? `${state.selectedParts.length} part${state.selectedParts.length === 1 ? "" : "s"}`
            : "No parts yet"}
        </span>
        <span className="numeric text-[15px] font-semibold text-[var(--color-ink)]">{formatCents(state.cost.totalCents)}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="flex-1 rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-[#08101c] transition-opacity hover:opacity-90"
        >
          Save build
        </button>
        <button
          type="button"
          onClick={onShare}
          className="flex-1 rounded border border-[var(--color-line-bright)] px-3 py-2 text-[13px] font-medium text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
        >
          Copy share link
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[10px] text-[var(--color-ink-faint)]">
          Saved in this browser only. No account, nothing uploaded.
        </p>
        {message ? (
          <span className="shrink-0 text-[11px] text-[var(--color-ok)]">{message}</span>
        ) : null}
      </div>

      {state.selectedParts.length > 0 ? (
        <button
          type="button"
          onClick={state.clear}
          className="mt-2 text-[11px] text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]"
        >
          Clear all parts
        </button>
      ) : null}
    </div>
  );
}
