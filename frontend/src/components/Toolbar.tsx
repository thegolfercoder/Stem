"use client";

/** Tool selection, view controls and the keyboard shortcuts that drive them. */

import { useEffect } from "react";

import { fitToPoints, DEFAULT_VIEWPORT } from "@/lib/viewport";
import { useWorkspace, type Tool } from "@/state/workspace";

const TOOLS: Array<{ id: Tool; label: string; key: string; hint: string }> = [
  { id: "draw", label: "Draw", key: "D", hint: "Sketch a curve to fit (D)" },
  { id: "pan", label: "Pan", key: "H", hint: "Drag to move the view (H)" },
];

export function Toolbar() {
  const tool = useWorkspace((state) => state.tool);
  const setTool = useWorkspace((state) => state.setTool);
  const snapToGrid = useWorkspace((state) => state.snapToGrid);
  const toggleSnap = useWorkspace((state) => state.toggleSnap);
  const undo = useWorkspace((state) => state.undo);
  const redo = useWorkspace((state) => state.redo);
  const clear = useWorkspace((state) => state.clear);
  const canUndo = useWorkspace((state) => state.past.length > 0);
  const canRedo = useWorkspace((state) => state.future.length > 0);

  const resetView = () => {
    const { layers, setViewport } = useWorkspace.getState();
    const points = layers.filter((l) => l.visible).flatMap((l) => l.points);
    setViewport(
      points.length > 0
        ? fitToPoints(points, { width: window.innerWidth - 360, height: window.innerHeight - 44 })
        : DEFAULT_VIEWPORT,
    );
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal keys from a field the user is typing in.
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier) return;

      switch (event.key.toLowerCase()) {
        case "d":
          setTool("draw");
          break;
        case "h":
          setTool("pan");
          break;
        case "g":
          toggleSnap();
          break;
        case "0":
          resetView();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, setTool, toggleSnap, undo]);

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5 rounded bg-[--color-surface-2] p-0.5">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTool(entry.id)}
            aria-pressed={tool === entry.id}
            title={entry.hint}
            className={`rounded px-2.5 py-1 transition-colors ${
              tool === entry.id
                ? "bg-[--color-surface-3] text-ink-0"
                : "text-ink-2 hover:text-ink-0"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <Divider />

      <ToolbarButton onClick={toggleSnap} active={snapToGrid} title="Snap to grid (G)">
        Snap
      </ToolbarButton>
      <ToolbarButton onClick={resetView} title="Fit everything in view (0)">
        Fit view
      </ToolbarButton>

      <Divider />

      <ToolbarButton onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
        Undo
      </ToolbarButton>
      <ToolbarButton onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
        Redo
      </ToolbarButton>
      <ToolbarButton onClick={clear} title="Remove all layers">
        Clear
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`rounded px-2.5 py-1 transition-colors disabled:cursor-not-allowed disabled:text-ink-3 ${
        active ? "bg-[--color-surface-3] text-ink-0" : "text-ink-2 hover:text-ink-0"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-[--color-line]" aria-hidden />;
}
