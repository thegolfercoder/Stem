"use client";

/**
 * The workspace shell.
 *
 * A fixed two-column layout: canvas on the left, a single scrolling inspector
 * on the right. The inspector is one column rather than a set of floating
 * panels, so the equation, its diagnostics and the layer that produced them
 * are always read in the same place and in the same order.
 */

import { useEffect, useState } from "react";

import { GraphCanvas } from "@/components/GraphCanvas";
import { ImportPanel } from "@/components/ImportPanel";
import { LayerList } from "@/components/LayerList";
import { ResultsPanel } from "@/components/ResultsPanel";
import { Toolbar } from "@/components/Toolbar";
import { health } from "@/lib/api";
import { useWorkspace } from "@/state/workspace";

export default function WorkspacePage() {
  const layers = useWorkspace((state) => state.layers);
  const activeLayerId = useWorkspace((state) => state.activeLayerId);
  const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? null;

  return (
    <div className="flex h-full flex-col bg-[--color-surface-0]">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[--color-line] px-3">
        <div className="flex items-center gap-3">
          <h1 className="font-medium tracking-tight text-ink-0">Reverse Desmos</h1>
          <span className="hidden text-ink-3 sm:inline">
            Draw, drop or paste — get the equation
          </span>
        </div>
        <Toolbar />
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <GraphCanvas />
          {layers.length === 0 && <EmptyCanvasHint />}
        </main>

        <aside
          className="flex w-[344px] shrink-0 flex-col overflow-y-auto border-l border-[--color-line] bg-[--color-surface-1]"
          aria-label="Inspector"
        >
          <Section title="Import">
            <ImportPanel />
          </Section>

          <Section title="Layers">
            <LayerList />
          </Section>

          <Section title="Equation" grow>
            {activeLayer ? (
              <ResultsPanel layer={activeLayer} />
            ) : (
              <p className="px-4 py-6 text-ink-2">Select a layer to see its equation.</p>
            )}
          </Section>

          <BackendStatus />
        </aside>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  grow,
}: {
  title: string;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <section className={`border-b border-[--color-line] ${grow ? "flex-1" : ""}`}>
      <h2 className="label px-4 pb-1 pt-3">{title}</h2>
      {children}
    </section>
  );
}

function EmptyCanvasHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="max-w-xs text-center">
        <p className="text-ink-1">Draw a curve</p>
        <p className="mt-1 text-ink-3">
          Sketch with the mouse or a stylus and the equation appears on the right.
          Scroll to zoom, shift-drag to pan.
        </p>
      </div>
    </div>
  );
}

/**
 * The fitting engine lives in a separate process. If it is not running, every
 * action fails with a network error and the cause is invisible — so the state
 * is surfaced once, quietly, instead of as a toast per failed request.
 */
function BackendStatus() {
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ok = await health();
      if (!cancelled) setReachable(ok);
    };
    void check();
    const timer = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (reachable !== false) return null;

  return (
    <div className="px-4 py-3 text-[--color-warning]">
      <p className="font-medium">Fitting engine unreachable</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-2">
        Start the backend with{" "}
        <code className="numeric text-ink-1">uvicorn app.main:app</code> in{" "}
        <code className="numeric text-ink-1">backend/</code>.
      </p>
    </div>
  );
}
