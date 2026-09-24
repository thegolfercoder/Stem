import type { Metadata } from "next";
import Link from "next/link";
import { Configurator } from "@/components/configurator/Configurator";
import { getCatalog } from "@/lib/catalog";
import { decodeShareCode } from "@/lib/build/share";

/**
 * A shared build.
 *
 * The build travels inside the URL, so this route needs no database and a link
 * works the moment it is copied. Everything in the code is untrusted: it is
 * validated by decodeShareCode, and every slug that survives that is then
 * looked up in the catalogue. A slug that matches nothing is dropped rather
 * than rendered, so a tampered link degrades into a smaller build instead of
 * doing anything interesting.
 *
 * Opening a shared link drops you into the configurator with those parts
 * loaded, so the natural next step is to change something and make it yours.
 */

export const metadata: Metadata = {
  title: "Shared build",
  robots: { index: false },
};

export default async function SharedBuildPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const shared = decodeShareCode(decodeURIComponent(code));

  if (!shared) return <BrokenLink reason="That link could not be read." />;

  const catalog = getCatalog();
  const [makeSlug, modelSlug, yearText] = shared.vehicleKey.split("/");
  const vehicle =
    makeSlug && modelSlug && yearText
      ? await catalog.getVehicle(makeSlug, modelSlug, Number(yearText))
      : null;

  if (!vehicle) {
    return (
      <BrokenLink reason="That link refers to a vehicle that is not in the catalogue." />
    );
  }

  const [parts, fitment] = await Promise.all([
    catalog.listParts(),
    catalog.getFitmentForVehicle(vehicle.profile?.id ?? vehicle.key),
  ]);

  const bySlug = new Map(parts.map((p) => [p.slug, p]));
  const partIds = shared.parts
    .map((p) => bySlug.get(p.slug)?.id)
    .filter((id): id is string => id !== undefined);

  const dropped = shared.parts.length - partIds.length;

  return (
    <main>
      <div className="mx-auto max-w-[1800px] px-3 pt-4 sm:px-4">
        <div className="rounded border border-[var(--color-accent)]/30 bg-[var(--color-accent-dim)]/30 px-3 py-2 text-[12px] text-[var(--color-ink-dim)]">
          Viewing a shared build. Change anything and save it as your own —
          the original link is unaffected.
          {dropped > 0 ? (
            <span className="ml-1 text-[var(--color-warn)]">
              {dropped} part{dropped === 1 ? "" : "s"} in this link{" "}
              {dropped === 1 ? "is" : "are"} not in the catalogue and{" "}
              {dropped === 1 ? "was" : "were"} left out.
            </span>
          ) : null}
        </div>
      </div>

      <Configurator
        vehicle={vehicle}
        catalogue={parts}
        fitmentRecords={[...fitment.values()]}
        init={{
          partIds,
          name: shared.name,
          paintHex: shared.paintHex,
        }}
      />
    </main>
  );
}

function BrokenLink({ reason }: { reason: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-20 text-center">
      <h1 className="text-[22px] font-semibold tracking-tight">
        This build link is broken
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-ink-dim)]">
        {reason} Share links carry the whole build inside the URL, so one that
        has been truncated in a chat window or an email will not open.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded border border-[var(--color-line-bright)] px-4 py-2 text-[13px] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
      >
        Start a new build
      </Link>
    </main>
  );
}
