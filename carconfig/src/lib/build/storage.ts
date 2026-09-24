import { z } from "zod";
import type { Build } from "@/types/build";
import { appearanceSchema } from "./appearance";
import { generateId } from "./share";

/**
 * Saved builds, in the browser.
 *
 * localStorage is the MVP's store. It is genuinely the right first choice —
 * no account required, nothing to host, and a build survives a refresh — and
 * it is genuinely not the last one: it is per-device, it is lost when somebody
 * clears their browser, and it cannot be shared.
 *
 * The interface below is what a server-backed store would also implement, so
 * adding accounts later means changing the implementation and the call sites'
 * await behaviour, not the shape of a build. Reads are defensive because
 * anything in localStorage can have been edited by hand or written by an older
 * version of this code.
 */

const STORAGE_KEY = "carconfig.builds.v1";

const buildPartSchema = z.object({
  partId: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(99),
  priceCentsAtSave: z.number().int().optional(),
  installCostCentsAtSave: z.number().int().optional(),
});

const buildSchema = z.object({
  id: z.string().min(1).max(64),
  shareCode: z.string().min(1).max(8000),
  name: z.string().min(1).max(80),
  vehicleId: z.string().min(1).max(200),
  parts: z.array(buildPartSchema).max(60),
  paintHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  appearance: appearanceSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ownerId: z.string().nullable().optional(),
});

const storedSchema = z.array(buildSchema);

function canUseStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/*
 * localStorage is an external store, so it is exposed as one: a snapshot, a
 * subscription, and a cached reference that only changes when the data does.
 *
 * The cache is not an optimisation — useSyncExternalStore compares snapshots
 * by identity and will loop forever if getSnapshot parses the JSON afresh on
 * every call. Reading it into component state from an effect instead would
 * cause a cascading render on every mount.
 */
let cache: readonly Build[] | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Server render, and any browser without storage, both see no saved builds. */
const EMPTY: readonly Build[] = [];

export function subscribeBuilds(listener: () => void): () => void {
  listeners.add(listener);

  // Another tab saving a build should update this one.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      cache = null;
      emit();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function getBuildsSnapshot(): readonly Build[] {
  if (!canUseStorage()) return EMPTY;
  if (cache === null) cache = loadBuilds();
  return cache;
}

export function getServerBuildsSnapshot(): readonly Build[] {
  return EMPTY;
}

export function loadBuilds(): readonly Build[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      // Rather than throwing away what might be somebody's saved builds
      // because one record is malformed, keep every record that does parse.
      const salvaged = (JSON.parse(raw) as unknown[])
        .map((entry) => buildSchema.safeParse(entry))
        .filter((r) => r.success)
        .map((r) => r.data);
      return salvaged as Build[];
    }

    return parsed.data as Build[];
  } catch {
    return [];
  }
}

function persist(builds: readonly Build[]): void {
  cache = builds;
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(builds));
    } catch {
      // Quota exceeded, or storage disabled in a private window. Losing a save
      // is bad; taking the whole page down with an uncaught exception is worse.
    }
  }
  emit();
}

export function saveBuild(build: Build): readonly Build[] {
  const builds = loadBuilds();
  const index = builds.findIndex((b) => b.id === build.id);
  const updated: Build = { ...build, updatedAt: new Date().toISOString() };

  const next =
    index >= 0
      ? [...builds.slice(0, index), updated, ...builds.slice(index + 1)]
      : [updated, ...builds];

  persist(next);
  return next;
}

export function deleteBuild(id: string): readonly Build[] {
  const next = loadBuilds().filter((b) => b.id !== id);
  persist(next);
  return next;
}

export function duplicateBuild(id: string): readonly Build[] {
  const builds = loadBuilds();
  const original = builds.find((b) => b.id === id);
  if (!original) return builds;

  const now = new Date().toISOString();
  const copy: Build = {
    ...original,
    id: generateId(),
    name: nextCopyName(original.name, builds),
    createdAt: now,
    updatedAt: now,
  };

  const next = [copy, ...builds];
  persist(next);
  return next;
}

export function getBuild(id: string): Build | null {
  return loadBuilds().find((b) => b.id === id) ?? null;
}

/** "Track M3" → "Track M3 (copy)" → "Track M3 (copy 2)". */
function nextCopyName(name: string, existing: readonly Build[]): string {
  const base = name.replace(/ \(copy( \d+)?\)$/, "");
  const taken = new Set(existing.map((b) => b.name));

  let candidate = `${base} (copy)`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base} (copy ${n})`;
    n += 1;
  }
  return candidate;
}
