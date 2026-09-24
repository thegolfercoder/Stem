import Link from "next/link";
import { VehicleSearch } from "@/components/vehicle/VehicleSearch";
import { getCatalog } from "@/lib/catalog";
import { CATALOG_STATS, IDENTITY_SOURCE } from "@/lib/catalog/identities";
import { catalogVehicleName } from "@/types/vehicle";

export default async function HomePage() {
  const catalog = getCatalog();
  const [makes, profiled] = await Promise.all([
    catalog.listMakes(),
    catalog.listProfiledVehicles(),
  ]);

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <section className="max-w-2xl">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[36px]">
          Find out what fits before you buy it.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-dim)]">
          Pick a car, add parts, and see the fitment checked against the car&apos;s
          own measurements — bolt pattern, offset, clearance, and what else is
          already in the build. Where nothing has been confirmed, it says so
          instead of guessing.
        </p>
      </section>

      <section className="mt-7 max-w-2xl">
        <VehicleSearch />
      </section>

      <section className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-[var(--color-ink-faint)]">
        <span className="numeric">
          <strong className="text-[var(--color-ink-dim)]">
            {CATALOG_STATS.modelYears.toLocaleString()}
          </strong>{" "}
          model-years
        </span>
        <span className="numeric">
          <strong className="text-[var(--color-ink-dim)]">
            {CATALOG_STATS.modelLines.toLocaleString()}
          </strong>{" "}
          model lines
        </span>
        <span className="numeric">
          <strong className="text-[var(--color-ink-dim)]">{CATALOG_STATS.makes}</strong>{" "}
          makes
        </span>
        <span className="numeric">
          <strong className="text-[var(--color-ok)]">{CATALOG_STATS.profiled}</strong>{" "}
          measured for fitment
        </span>
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[17px] font-semibold tracking-tight">
            Cars we have measured
          </h2>
          <Link
            href="/data"
            className="text-[12px] text-[var(--color-accent)] hover:underline"
          >
            What &ldquo;measured&rdquo; means
          </Link>
        </div>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[var(--color-ink-dim)]">
          These have bolt patterns, hub bores, clearance envelopes and rotor
          sizes on record, so the engine can check a wheel against arithmetic
          rather than shrugging. Every other car in the catalogue opens and
          configures too — it just answers &ldquo;unknown&rdquo; until somebody
          measures it.
        </p>

        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {profiled.map((vehicle) => (
            <li key={vehicle.key}>
              <Link
                href={`/configure/${vehicle.key}`}
                className="group flex h-full flex-col rounded border border-[var(--color-line)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-line-bright)] hover:bg-[var(--color-surface-2)]"
              >
                <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
                  {vehicle.make}
                </div>
                <h3 className="mt-0.5 text-[16px] font-semibold tracking-tight">
                  {vehicle.model}
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--color-ink-dim)]">
                  {vehicle.profile?.trim} · {vehicle.profile?.generationCode}
                </div>

                <dl className="numeric mt-3 grid grid-cols-3 gap-2 border-t border-[var(--color-line)] pt-3 text-[13px]">
                  <div>
                    <dt className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
                      Power
                    </dt>
                    <dd>{vehicle.profile?.stockPowerHp} hp</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
                      Weight
                    </dt>
                    <dd>{vehicle.profile?.stockWeightKg} kg</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
                      Bolts
                    </dt>
                    <dd>
                      {vehicle.profile?.wheels.front.boltCount}x
                      {vehicle.profile?.wheels.front.boltCircleMm}
                    </dd>
                  </div>
                </dl>

                <span className="mt-3 text-[12px] text-[var(--color-ink-dim)] transition-colors group-hover:text-[var(--color-accent)]">
                  Configure {catalogVehicleName(vehicle)} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-[17px] font-semibold tracking-tight">Browse by make</h2>
        <p className="mt-1.5 text-[13px] text-[var(--color-ink-dim)]">
          Vehicle list imported from {IDENTITY_SOURCE.source} — {IDENTITY_SOURCE.licence}.
        </p>

        <ul className="mt-4 flex flex-wrap gap-2">
          {makes.map((make) => (
            <li key={make.slug}>
              <Link
                href={`/browse/${make.slug}`}
                className="inline-flex items-baseline gap-1.5 rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
              >
                {make.name}
                <span className="numeric text-[11px] text-[var(--color-ink-faint)]">
                  {make.modelCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
