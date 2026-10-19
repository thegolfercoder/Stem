"use client";

import { useCallback, useMemo, useState } from "react";
import { applyAppearance, type Appearance } from "@/lib/build/appearance";
import { deriveViewerConfig } from "@/lib/build/viewer-config";
import { evaluateCompatibility } from "@/lib/compatibility/engine";
import { estimatePerformance } from "@/lib/performance";
import { calculateBuildCost } from "@/lib/pricing";
import type { CompatibilityResult } from "@/types/compatibility";
import { worstStatus } from "@/types/compatibility";
import type { FitmentRecord, Part } from "@/types/part";
import { partCategory } from "@/types/part";
import type { CatalogVehicle } from "@/types/vehicle";

/**
 * The configurator's state, and everything derived from it.
 *
 * The state itself is three values: which parts are selected, what the build
 * is called, and how it looks (paint, wheels, stance — see appearance.ts). Cost, compatibility, performance
 * and the 3D configuration are all recomputed from those — nothing derived is
 * ever stored, so nothing derived can drift out of sync with the build.
 *
 * With a catalogue this size that recomputation is free. If it ever stops
 * being free the answer is memoising per part, not caching results in state.
 */

export interface ConfiguratorInit {
  readonly partIds?: readonly string[];
  readonly name?: string;
  /** Older links carry only a paint colour. */
  readonly paintHex?: string;
  readonly appearance?: Appearance;
}

export function useConfigurator(
  vehicle: CatalogVehicle,
  catalogue: readonly Part[],
  fitmentRecords: readonly FitmentRecord[],
  init?: ConfiguratorInit,
) {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(
    init?.partIds ?? [],
  );
  const [name, setName] = useState(init?.name ?? `${vehicle.model} build`);
  const [appearance, setAppearanceState] = useState<Appearance>(
    init?.appearance ?? (init?.paintHex ? { paintHex: init.paintHex } : {}),
  );
  /** Merge a change into the appearance; `undefined` clears a field back to the build's own. */
  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    setAppearanceState((current) => ({ ...current, ...patch }));
  }, []);
  const resetAppearance = useCallback(() => setAppearanceState({}), []);

  const partsById = useMemo(
    () => new Map(catalogue.map((p) => [p.id, p])),
    [catalogue],
  );

  const fitmentByPartId = useMemo(
    () => new Map(fitmentRecords.map((r) => [r.partId, r])),
    [fitmentRecords],
  );

  const selectedParts = useMemo(
    () =>
      selectedIds
        .map((id) => partsById.get(id))
        .filter((p): p is Part => p !== undefined),
    [selectedIds, partsById],
  );

  /**
   * Evaluate a part as if it were in the build.
   *
   * The context excludes anything this part would replace — otherwise a wheel
   * would be checked against the wheel it is about to displace, and every
   * single-select category would contradict itself.
   */
  const evaluate = useCallback(
    (part: Part): CompatibilityResult => {
      const category = partCategory(part.category);
      const others = selectedParts.filter(
        (p) =>
          p.id !== part.id &&
          !(category.singleSelect && p.category === part.category),
      );

      return evaluateCompatibility({
        vehicle,
        part,
        selected: others,
        fitment: fitmentByPartId.get(part.id),
      });
    },
    [vehicle, selectedParts, fitmentByPartId],
  );

  /** Verdicts for the parts actually in the build. */
  const selectedResults = useMemo(() => {
    const map = new Map<string, CompatibilityResult>();
    for (const part of selectedParts) map.set(part.id, evaluate(part));
    return map;
  }, [selectedParts, evaluate]);

  const buildStatus = useMemo(
    () => worstStatus([...selectedResults.values()].map((r) => r.status)),
    [selectedResults],
  );

  const cost = useMemo(
    () => calculateBuildCost(selectedParts.map((part) => ({ part, quantity: 1 }))),
    [selectedParts],
  );

  // No profile means no stock power or weight to reason from, so there is
  // nothing to estimate and the panel is hidden rather than showing zeroes.
  const performance = useMemo(
    () =>
      vehicle.profile
        ? estimatePerformance(vehicle.profile, selectedParts)
        : null,
    [vehicle, selectedParts],
  );

  const viewerConfig = useMemo(
    () => applyAppearance(deriveViewerConfig(vehicle, selectedParts), appearance),
    [vehicle, selectedParts, appearance],
  );

  const toggle = useCallback(
    (part: Part) => {
      setSelectedIds((current) => {
        if (current.includes(part.id)) {
          return current.filter((id) => id !== part.id);
        }

        const category = partCategory(part.category);
        if (!category.singleSelect) return [...current, part.id];

        // Single-select: the new part replaces whatever was in that category.
        const withoutCategory = current.filter(
          (id) => partsById.get(id)?.category !== part.category,
        );
        return [...withoutCategory, part.id];
      });

      // Picking a paint part clears a hand-picked colour, so the part wins.
      if (part.category === "paint") setAppearance({ paintHex: undefined, paintFinish: undefined });
    },
    [partsById, setAppearance],
  );

  const remove = useCallback((partId: string) => {
    setSelectedIds((current) => current.filter((id) => id !== partId));
  }, []);

  const clear = useCallback(() => {
    setSelectedIds([]);
  }, []);

  return {
    vehicle,
    catalogue,
    name,
    setName,
    selectedIds,
    selectedParts,
    selectedResults,
    buildStatus,
    cost,
    performance,
    viewerConfig,
    appearance,
    setAppearance,
    resetAppearance,
    evaluate,
    toggle,
    remove,
    clear,
    isSelected: useCallback(
      (partId: string) => selectedIds.includes(partId),
      [selectedIds],
    ),
  };
}

export type ConfiguratorState = ReturnType<typeof useConfigurator>;
