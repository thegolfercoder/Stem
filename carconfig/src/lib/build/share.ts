import { z } from "zod";
import type { EncodedBuild } from "@/types/build";

/**
 * Share links.
 *
 * A build is encoded into the URL itself rather than stored server-side. That
 * is a deliberate MVP choice with a real advantage: a link works immediately,
 * needs no database, and cannot leak anybody else's builds because there is
 * nothing to enumerate. The cost is that a very large build makes a very long
 * URL, and that links do not update when the build does.
 *
 * The server-backed form — POST the build, get /b/abc123 — is the same
 * function signature with a network call in it, and the `builds` table in
 * db/schema.sql is already shaped for it.
 *
 * Everything decoded here is untrusted input from a URL. It is validated
 * against a schema before anything touches it, and the slugs that come out are
 * looked up in the catalogue rather than being used directly — an unknown slug
 * finds nothing, which is the correct outcome for a tampered link.
 */

const SLUG = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9-]+$/, "slugs are lowercase alphanumeric and hyphens");

const encodedBuildSchema = z.object({
  v: z.literal(1),
  c: SLUG,
  n: z.string().min(1).max(80),
  p: z
    .array(z.union([SLUG, z.tuple([SLUG, z.number().int().min(1).max(99)])]))
    .max(60),
  h: z
    .string()
    .regex(/^[0-9a-fA-F]{6}$/)
    .optional(),
});

export interface ShareableBuild {
  readonly vehicleSlug: string;
  readonly name: string;
  readonly parts: readonly { slug: string; quantity: number }[];
  readonly paintHex?: string;
}

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShareCode(build: ShareableBuild): string {
  const payload: EncodedBuild = {
    v: 1,
    c: build.vehicleSlug,
    n: build.name.slice(0, 80),
    p: build.parts.map((p) =>
      p.quantity === 1 ? p.slug : ([p.slug, p.quantity] as const),
    ),
    h: build.paintHex?.replace(/^#/, ""),
  };

  return toBase64Url(JSON.stringify(payload));
}

/**
 * Decode a share code, or return null.
 *
 * Never throws. A malformed code is a broken link, which is a thing the page
 * should handle by saying so — not a crash.
 */
export function decodeShareCode(code: string): ShareableBuild | null {
  // A guard before doing any work: nothing legitimate is this large, and it
  // stops a very long URL turning into a very large allocation.
  if (!code || code.length > 8000) return null;

  try {
    const json = fromBase64Url(code);
    const parsed = encodedBuildSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;

    const data = parsed.data;
    return {
      vehicleSlug: data.c,
      name: data.n,
      parts: data.p.map((entry) =>
        typeof entry === "string"
          ? { slug: entry, quantity: 1 }
          : { slug: entry[0], quantity: entry[1] },
      ),
      paintHex: data.h ? `#${data.h}` : undefined,
    };
  } catch {
    return null;
  }
}

/** A short, non-sequential id. Builds must not be enumerable by counting. */
export function generateId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}
