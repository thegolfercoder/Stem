"use client";

/** Bringing data in: spreadsheets, JSON, typed pairs, and screenshots. */

import { useRef, useState } from "react";

import { extractFromImage } from "@/lib/api";
import { ImportError, parseFile, parseManualEntry } from "@/lib/data-import";
import { fitToPoints } from "@/lib/viewport";
import { useWorkspace } from "@/state/workspace";

type Mode = "file" | "manual" | "image";

const PLACEHOLDER = `0, 1
1, 2.7
2, 7.4
3, 20.1`;

export function ImportPanel() {
  const [mode, setMode] = useState<Mode>("file");

  return (
    <div className="flex flex-col">
      <div
        className="flex gap-1 px-3 pt-3"
        role="tablist"
        aria-label="Import source"
      >
        {(
          [
            ["file", "File"],
            ["manual", "Type"],
            ["image", "Screenshot"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`rounded px-2.5 py-1 transition-colors ${
              mode === value
                ? "bg-[--color-surface-3] text-ink-0"
                : "text-ink-2 hover:text-ink-0"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-3">
        {mode === "file" && <FileImport />}
        {mode === "manual" && <ManualImport />}
        {mode === "image" && <ScreenshotImport />}
      </div>
    </div>
  );
}

/** Shared plumbing: turn parsed points into a fitted layer and frame them. */
function useIngest() {
  const addLayer = useWorkspace((state) => state.addLayer);
  const runFit = useWorkspace((state) => state.runFit);
  const setViewport = useWorkspace((state) => state.setViewport);

  return (
    points: { x: number; y: number }[],
    source: "data" | "screenshot",
    name?: string,
  ) => {
    const layerId = addLayer(source, points, name);
    // Frame the new data. Canvas size is not known here, so a representative
    // size is used; the viewport is corrected on the next resize anyway.
    setViewport(fitToPoints(points, { width: 900, height: 700 }));
    void runFit(layerId);
    return layerId;
  };
}

function FileImport() {
  const ingest = useIngest();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setStatus(null);
    try {
      const parsed = await parseFile(file);
      ingest(parsed.points, "data", file.name.replace(/\.[^.]+$/, ""));
      setStatus(
        [`Imported ${parsed.points.length} points`, ...parsed.notes].join(" · "),
      );
    } catch (caught) {
      setError(
        caught instanceof ImportError || caught instanceof Error
          ? caught.message
          : "Could not read that file",
      );
    }
  };

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
        className={`rounded border border-dashed p-4 text-center transition-colors ${
          dragging
            ? "border-[--color-accent] bg-[--color-surface-2]"
            : "border-[--color-line-strong]"
        }`}
      >
        <p className="text-ink-1">Drop a CSV, Excel or JSON file</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-2 rounded border border-[--color-line-strong] px-3 py-1.5 text-ink-1 transition-colors hover:border-[--color-ink-3] hover:text-ink-0"
        >
          Choose file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.json,.xlsx,.xls,.xlsm"
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>
      <Feedback status={status} error={error} />
      <p className="mt-2 text-[11px] leading-snug text-ink-2">
        The first two columns are read as x and y. A non-numeric first row is
        treated as a header.
      </p>
    </div>
  );
}

function ManualImport() {
  const ingest = useIngest();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    setStatus(null);
    try {
      const parsed = parseManualEntry(text);
      ingest(parsed.points, "data", "Typed data");
      setStatus(`Imported ${parsed.points.length} points`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that");
    }
  };

  return (
    <div>
      <label htmlFor="manual-points" className="label">
        One pair per line
      </label>
      <textarea
        id="manual-points"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={PLACEHOLDER}
        rows={7}
        spellCheck={false}
        className="numeric mt-1.5 w-full resize-y rounded border border-[--color-line-strong] bg-[--color-surface-0] p-2 text-ink-0 placeholder:text-ink-3"
      />
      <button
        type="button"
        onClick={submit}
        disabled={text.trim().length === 0}
        className="mt-2 w-full rounded bg-[--color-accent] px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Fit equation
      </button>
      <Feedback status={status} error={error} />
    </div>
  );
}

function ScreenshotImport() {
  const ingest = useIngest();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [unitsPerCell, setUnitsPerCell] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const handleFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    const scale = Number(unitsPerCell);
    if (!Number.isFinite(scale) || scale <= 0) {
      setError("Grid scale must be a positive number");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await extractFromImage(file, { unitsPerCell: scale });
      const largest = result.curves
        .slice()
        .sort((a, b) => b.pixel_count - a.pixel_count)[0];

      if (!largest) {
        setError(result.notes[0] ?? "No curve was found in that image");
        return;
      }

      const points = largest.x.map((x, index) => ({ x, y: largest.y[index]! }));
      ingest(points, "screenshot", file.name.replace(/\.[^.]+$/, ""));

      const extra = result.curves.length > 1 ? ` · ${result.curves.length} curves found, used the longest` : "";
      setStatus(`Traced ${points.length} points${extra}`);
      if (result.notes.length > 0) setError(result.notes.join(" · "));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label htmlFor="units-per-cell" className="label">
        One grid square equals
      </label>
      <input
        id="units-per-cell"
        type="number"
        min="0"
        step="any"
        value={unitsPerCell}
        onChange={(event) => setUnitsPerCell(event.target.value)}
        className="numeric mt-1.5 w-full rounded border border-[--color-line-strong] bg-[--color-surface-0] px-2 py-1.5 text-ink-0"
      />
      <p className="mt-1.5 text-[11px] leading-snug text-ink-2">
        Axes and grid pitch are measured from the image. Tick labels are not
        read, so set this to match the plot&rsquo;s scale.
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-3 w-full rounded bg-[--color-accent] px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Reading image…" : "Choose screenshot"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleFile(event.target.files)}
      />
      <Feedback status={status} error={error} />
    </div>
  );
}

function Feedback({ status, error }: { status: string | null; error: string | null }) {
  if (!status && !error) return null;
  return (
    <div className="mt-2 space-y-1">
      {status && <p className="text-[--color-positive]">{status}</p>}
      {error && <p className="text-[--color-warning]">{error}</p>}
    </div>
  );
}
