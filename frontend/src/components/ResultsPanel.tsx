"use client";

/** Ranked candidate equations, their diagnostics, and live parameter editing. */

import { AnimatePresence, motion } from "framer-motion";

import { Equation } from "@/components/Equation";
import { ResidualPlot } from "@/components/ResidualPlot";
import type { Candidate, Layer } from "@/lib/types";
import { effectiveParameters, selectedCandidate, useWorkspace } from "@/state/workspace";

export function ResultsPanel({ layer }: { layer: Layer }) {
  const showResiduals = useWorkspace((state) => state.showResiduals);
  const toggleResiduals = useWorkspace((state) => state.toggleResiduals);
  const selectCandidate = useWorkspace((state) => state.selectCandidate);
  const runFit = useWorkspace((state) => state.runFit);

  const active = selectedCandidate(layer);

  if (layer.status === "fitting") {
    return <PanelMessage>Searching model space…</PanelMessage>;
  }

  if (layer.status === "error") {
    return (
      <div className="p-4">
        <p className="text-[--color-negative]">{layer.error ?? "Fit failed"}</p>
        <button
          type="button"
          onClick={() => void runFit(layer.id)}
          className="mt-3 rounded border border-[--color-line-strong] px-3 py-1.5 text-ink-1 transition-colors hover:border-[--color-ink-3] hover:text-ink-0"
        >
          Try again
        </button>
      </div>
    );
  }

  if (layer.candidates.length === 0) {
    return <PanelMessage>No equation yet.</PanelMessage>;
  }

  return (
    <div className="flex flex-col">
      {active && <ActiveEquation layer={layer} candidate={active} />}

      <div className="border-t border-[--color-line]">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="label">Candidates</span>
          <span className="label numeric">{layer.candidates.length} shown</span>
        </div>

        <ul className="pb-2">
          {layer.candidates.map((candidate, index) => (
            <CandidateRow
              key={candidate.kind}
              candidate={candidate}
              rank={index + 1}
              isActive={candidate.kind === layer.selectedKind}
              colour={layer.colour}
              onSelect={() => selectCandidate(layer.id, candidate.kind)}
            />
          ))}
        </ul>
      </div>

      {active && (
        <div className="border-t border-[--color-line]">
          <button
            type="button"
            onClick={toggleResiduals}
            className="flex w-full items-center justify-between px-4 py-2 text-left transition-colors hover:bg-[--color-surface-2]"
            aria-expanded={showResiduals}
          >
            <span className="label">Residuals</span>
            <span className="text-ink-2">{showResiduals ? "Hide" : "Show"}</span>
          </button>
          <AnimatePresence initial={false}>
            {showResiduals && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="px-2 pb-3">
                  <ResidualPlot
                    x={sampleX(layer, active)}
                    residuals={active.residuals}
                    colour={layer.colour}
                  />
                  <p className="px-2 pt-1 text-[11px] leading-snug text-ink-2">
                    A shapeless band means the model fits. A visible arc or wave
                    means the wrong family, however high R² is.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function ActiveEquation({ layer, candidate }: { layer: Layer; candidate: Candidate }) {
  const setParameter = useWorkspace((state) => state.setParameter);
  const resetParameters = useWorkspace((state) => state.resetParameters);

  const values = effectiveParameters(layer, candidate);
  const edited = layer.overrides[candidate.kind] !== undefined;

  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">{candidate.label}</span>
        {candidate.exact && (
          <span
            className="rounded-sm bg-[--color-accent-dim] px-1.5 py-0.5 text-[10px] font-medium text-ink-0"
            title="Parameters were snapped to exact values without losing accuracy"
          >
            exact form
          </span>
        )}
      </div>

      <div className="mt-2 overflow-x-auto py-1">
        <Equation
          latex={candidate.latex}
          fallback={candidate.text}
          className="text-[15px] text-ink-0"
        />
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-x-3 gap-y-2">
        <Statistic label="R²" value={formatR2(candidate.metrics.r2)} />
        <Statistic label="RMSE" value={formatNumber(candidate.metrics.rmse)} />
        {/* Abbreviated: the four statistics sit in one row, and "Confidence"
            is the only label wide enough to truncate at this column width. */}
        <Statistic
          label="Conf."
          value={`${Math.round(candidate.confidence * 100)}%`}
        />
        <Statistic label="Params" value={String(candidate.metrics.k)} />
      </dl>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="label">Parameters</span>
          {edited && (
            <button
              type="button"
              onClick={() => resetParameters(layer.id, candidate.kind)}
              className="text-[11px] text-ink-2 transition-colors hover:text-ink-0"
            >
              Reset to fit
            </button>
          )}
        </div>

        <div className="mt-2 space-y-2.5">
          {candidate.params.map((parameter, index) => (
            <div key={parameter.name}>
              <div className="flex items-baseline justify-between">
                <label
                  htmlFor={`${layer.id}-${candidate.kind}-${parameter.name}`}
                  className="numeric text-ink-1"
                >
                  {parameter.name}
                </label>
                <span className="numeric text-ink-1">
                  {formatNumber(values[index] ?? parameter.value)}
                  {parameter.stderr !== null && !edited && (
                    <span className="text-ink-3"> ± {formatNumber(parameter.stderr)}</span>
                  )}
                </span>
              </div>
              <input
                id={`${layer.id}-${candidate.kind}-${parameter.name}`}
                type="range"
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                value={values[index] ?? parameter.value}
                onChange={(event) =>
                  setParameter(
                    layer.id,
                    candidate.kind,
                    index,
                    Number(event.target.value),
                  )
                }
              />
            </div>
          ))}
        </div>

        {edited && (
          <p className="mt-2 text-[11px] leading-snug text-ink-2">
            Showing edited parameters. The statistics above describe the original
            fit.
          </p>
        )}
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
  rank,
  isActive,
  colour,
  onSelect,
}: {
  candidate: Candidate;
  rank: number;
  isActive: boolean;
  colour: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={isActive}
        className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
          isActive ? "bg-[--color-surface-3]" : "hover:bg-[--color-surface-2]"
        }`}
      >
        <span className="numeric w-3 shrink-0 text-ink-3">{rank}</span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-ink-0">{candidate.label}</span>
          <span className="numeric block truncate text-[11px] text-ink-2">
            {candidate.text.replace(/^y = /, "")}
          </span>
        </span>

        <span className="flex w-16 shrink-0 flex-col items-end gap-1">
          <span className="numeric text-[11px] text-ink-1">
            {Math.round(candidate.confidence * 100)}%
          </span>
          {/* The bar makes the ranking scannable without reading every number. */}
          <span className="h-0.5 w-full overflow-hidden rounded-full bg-[--color-line]">
            <span
              className="block h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${Math.max(2, candidate.confidence * 100)}%`,
                backgroundColor: isActive ? colour : "#4a4e59",
              }}
            />
          </span>
        </span>
      </button>
    </li>
  );
}

function Statistic({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="label truncate">{label}</dt>
      <dd className="numeric truncate text-ink-0">{value}</dd>
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-ink-2">{children}</p>;
}

/**
 * The x values the residuals line up with.
 *
 * The backend returns residuals in the order of its cleaned sample, which has
 * been sorted by x and may have merged duplicates — so the layer's raw points
 * cannot be used directly. Sorting a copy reproduces that order; when the
 * counts still disagree (duplicates were merged) the index is used, which
 * keeps the plot honest about ordering without inventing coordinates.
 */
function sampleX(layer: Layer, candidate: Candidate): number[] {
  const sorted = [...layer.points].sort((a, b) => a.x - b.x).map((point) => point.x);
  if (sorted.length === candidate.residuals.length) return sorted;
  return candidate.residuals.map((_, index) => index);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e6)) {
    return value.toExponential(2);
  }
  return value.toFixed(magnitude < 1 ? 4 : 3).replace(/\.?0+$/, "");
}

/** R² needs enough decimals to distinguish 0.9991 from 0.9999. */
function formatR2(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value > 0.9999) return value.toFixed(6);
  return value.toFixed(4);
}
