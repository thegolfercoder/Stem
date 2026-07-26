/**
 * Reading coordinate pairs out of whatever the user has to hand.
 *
 * Delimited text is parsed here rather than with a CSV library, because the
 * job is narrower than general CSV: two numeric columns. That lets the parser
 * be forgiving in ways that matter — a copied column of tab-separated numbers,
 * a European decimal comma, a header row or not — without pulling in a
 * dependency whose edge cases are mostly about quoted newlines we do not need.
 *
 * Spreadsheets go through SheetJS, since .xlsx is a zip of XML and there is no
 * forgiving hand-written version of that.
 */

import type { Point } from "./types";

export interface ParsedData {
  points: Point[];
  /** Column headers, when the source had them. */
  labels: { x: string; y: string } | null;
  notes: string[];
}

export class ImportError extends Error {}

/** Split a line on the delimiter that yields the most consistent columns. */
function detectDelimiter(lines: string[]): string {
  const candidates = [",", "\t", ";", /\s+/.source];
  let best = ",";
  let bestScore = -1;

  for (const delimiter of candidates) {
    const pattern = delimiter === /\s+/.source ? /\s+/ : delimiter;
    const counts = lines
      .slice(0, 12)
      .map((line) => line.split(pattern).length)
      .filter((count) => count > 1);
    if (counts.length === 0) continue;

    // Prefer the delimiter that splits every line into the same number of
    // columns; ties break towards more columns.
    const consistent = counts.every((count) => count === counts[0]);
    const score = (consistent ? 100 : 0) + (counts[0] ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function toNumber(raw: string): number {
  const text = raw.trim().replace(/^["']|["']$/g, "");
  if (text === "") return Number.NaN;
  // Accept "1 234,5" (European) as well as "1,234.5" (Anglo). A comma is a
  // decimal separator only when it is the sole comma and no dot is present.
  const normalised =
    !text.includes(".") && (text.match(/,/g) ?? []).length === 1
      ? text.replace(",", ".")
      : text.replace(/,/g, "");
  return Number(normalised.replace(/\s/g, ""));
}

function rowsToPoints(rows: string[][]): ParsedData {
  const notes: string[] = [];
  if (rows.length === 0) throw new ImportError("The file is empty");

  const first = rows[0]!;
  if (first.length < 2) {
    throw new ImportError("Expected at least two columns of numbers");
  }

  // A first row whose first two cells are not numeric is a header.
  const headerLooksTextual =
    Number.isNaN(toNumber(first[0] ?? "")) || Number.isNaN(toNumber(first[1] ?? ""));
  const labels = headerLooksTextual
    ? { x: (first[0] ?? "x").trim(), y: (first[1] ?? "y").trim() }
    : null;
  const body = headerLooksTextual ? rows.slice(1) : rows;

  const points: Point[] = [];
  let skipped = 0;
  for (const row of body) {
    const x = toNumber(row[0] ?? "");
    const y = toNumber(row[1] ?? "");
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
    else skipped += 1;
  }

  if (points.length < 2) {
    throw new ImportError("Found fewer than two usable numeric rows");
  }
  if (skipped > 0) notes.push(`Skipped ${skipped} row(s) without two numbers`);
  if (rows[0]!.length > 2) {
    notes.push(`Used the first two of ${rows[0]!.length} columns`);
  }

  return { points, labels, notes };
}

export function parseDelimitedText(text: string): ParsedData {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length === 0) throw new ImportError("No data found");

  const delimiter = detectDelimiter(lines);
  const pattern = delimiter === /\s+/.source ? /\s+/ : delimiter;
  return rowsToPoints(lines.map((line) => line.split(pattern)));
}

/**
 * Parse JSON in any of the shapes people actually have:
 * `[[x, y], ...]`, `[{x, y}, ...]`, or `{x: [...], y: [...]}`.
 */
export function parseJson(text: string): ParsedData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ImportError(
      error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON",
    );
  }

  const points: Point[] = [];

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const x = Number(entry[0]);
        const y = Number(entry[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
      } else if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const x = Number(record.x ?? record.X);
        const y = Number(record.y ?? record.Y);
        if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
      }
    }
  } else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const xs = record.x ?? record.X;
    const ys = record.y ?? record.Y;
    if (Array.isArray(xs) && Array.isArray(ys)) {
      const count = Math.min(xs.length, ys.length);
      for (let index = 0; index < count; index += 1) {
        const x = Number(xs[index]);
        const y = Number(ys[index]);
        if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
      }
    }
  }

  if (points.length < 2) {
    throw new ImportError(
      "Expected [[x, y], ...], [{x, y}, ...] or {x: [...], y: [...]}",
    );
  }
  return { points, labels: null, notes: [] };
}

/** Parse a spreadsheet. SheetJS is imported lazily — it is ~800 KB. */
export async function parseSpreadsheet(file: File): Promise<ParsedData> {
  const { read, utils } = await import("xlsx");
  const workbook = read(await file.arrayBuffer(), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new ImportError("The workbook has no sheets");

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new ImportError("The first sheet is empty");

  const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const result = rowsToPoints(
    rows.map((row) => row.map((cell) => (cell == null ? "" : String(cell)))),
  );
  if (workbook.SheetNames.length > 1) {
    result.notes.push(`Read "${sheetName}"; the file has ${workbook.SheetNames.length} sheets`);
  }
  return result;
}

/** Dispatch on file extension, falling back to sniffing the contents. */
export async function parseFile(file: File): Promise<ParsedData> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
    return parseSpreadsheet(file);
  }

  const text = await file.text();
  if (name.endsWith(".json")) return parseJson(text);
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    return parseDelimitedText(text);
  }

  const head = text.trimStart()[0];
  return head === "[" || head === "{" ? parseJson(text) : parseDelimitedText(text);
}

/** Parse the free-text box, where people paste or type pairs directly. */
export function parseManualEntry(text: string): ParsedData {
  const cleaned = text.replace(/[()]/g, " ");
  return parseDelimitedText(cleaned);
}
