/** Typed client for the FastAPI backend. */

import type { ExtractResponse, FitResponse, Point } from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      // FastAPI validation errors arrive as a list of field-level objects.
      const first = body.detail[0] as { msg?: string } | undefined;
      if (first?.msg) return first.msg;
    }
  } catch {
    // Fall through to the status text below.
  }
  return response.statusText || "Request failed";
}

/**
 * Rank candidate equations for a set of points.
 *
 * `signal` lets a caller abandon an in-flight solve — the user redrawing
 * before the previous fit returns should not race with it.
 */
export async function fit(
  points: readonly Point[],
  options: { maxResults?: number; kinds?: string[]; signal?: AbortSignal } = {},
): Promise<FitResponse> {
  const response = await fetch(`${API_BASE}/api/fit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      points,
      max_results: options.maxResults ?? 6,
      kinds: options.kinds ?? [],
    }),
  });

  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as FitResponse;
}

/** Recover plotted curves from a screenshot. */
export async function extractFromImage(
  file: File,
  options: { unitsPerCell?: number; signal?: AbortSignal } = {},
): Promise<ExtractResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("units_per_cell", String(options.unitsPerCell ?? 1));

  const response = await fetch(`${API_BASE}/api/extract`, {
    method: "POST",
    body: form,
    signal: options.signal,
  });

  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as ExtractResponse;
}

export async function health(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}
