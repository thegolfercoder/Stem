import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog";

/**
 * Vehicle search.
 *
 * The identity catalogue is a few hundred kilobytes and must never be shipped
 * to the browser, so searching it happens here and the picker asks over the
 * network. At a thousand model lines the scan is sub-millisecond; the reason
 * this is a route rather than a bundled array is bundle size, not speed.
 */

export const dynamic = "force-dynamic";

const MAX_QUERY = 64;
const LIMIT = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("q") ?? "";

  // Untrusted input: bound it before it reaches the catalogue.
  const query = raw.slice(0, MAX_QUERY).trim();
  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const hits = await getCatalog().searchModels(query, LIMIT);

  return NextResponse.json(
    {
      results: hits.map((h) => ({
        makeSlug: h.makeSlug,
        make: h.make,
        modelSlug: h.modelSlug,
        model: h.model,
        yearFrom: h.years[0],
        yearTo: h.years[h.years.length - 1],
        hasProfile: h.hasProfile,
      })),
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
