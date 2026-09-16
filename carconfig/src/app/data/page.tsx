import type { Metadata } from "next";
import { VerificationBadge } from "@/components/ui/badges";
import { PARTS } from "@/data/parts";
import { VEHICLES } from "@/data/vehicles";
import { DEFAULT_RULES } from "@/lib/compatibility/engine";
import { VERIFICATION_DESCRIPTIONS, VERIFICATION_LEVELS } from "@/types/provenance";

export const metadata: Metadata = {
  title: "Data quality",
  description: "Where this data comes from and how far it can be trusted.",
};

/**
 * The page that says what is actually known.
 *
 * Worth having as a real page rather than a footnote. The product's claim is
 * that it will tell you when it does not know something, and a claim like that
 * is only worth anything if it is written down somewhere a user can check it
 * against what the configurator is showing them.
 */
export default function DataPage() {
  const rules = [...DEFAULT_RULES].sort((a, b) => a.key.localeCompare(b.key));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-[26px] font-semibold tracking-tight">Data quality</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-dim)]">
        This is a working prototype, and the honest summary is that{" "}
        <strong className="text-[var(--color-ink)]">
          nothing in it has been verified against a primary source
        </strong>
        . The catalogue is {VEHICLES.length} vehicles and {PARTS.length} parts,
        chosen to exercise the compatibility engine rather than to be a
        reference. Everything below says which kind of claim each figure is, so
        nothing here has to be taken on trust.
      </p>

      <section className="mt-10">
        <h2 className="text-[17px] font-semibold tracking-tight">
          What the labels mean
        </h2>
        <dl className="mt-4 space-y-3">
          {VERIFICATION_LEVELS.map((level) => (
            <div
              key={level}
              className="flex flex-col gap-1.5 rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <dt className="shrink-0 sm:w-28">
                <VerificationBadge level={level} />
              </dt>
              <dd className="text-[13px] leading-relaxed text-[var(--color-ink-dim)]">
                {VERIFICATION_DESCRIPTIONS[level]}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-[17px] font-semibold tracking-tight">
          What is what, in this build of the app
        </h2>
        <ul className="mt-4 space-y-3 text-[13px] leading-relaxed text-[var(--color-ink-dim)]">
          <li className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
            <strong className="text-[var(--color-ink)]">
              Vehicle power, torque, weight and stock fitment
            </strong>{" "}
            — <VerificationBadge level="unverified" />. Transcribed from generally
            published manufacturer figures. These vary by market and model year,
            and kerb weight is quoted on several different standards depending on
            who published it.
          </li>
          <li className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
            <strong className="text-[var(--color-ink)]">
              Wheel clearance envelopes
            </strong>{" "}
            — <VerificationBadge level="estimated" />. No manufacturer publishes
            the range of offsets and widths a car will accept, so these are
            derived from the stock fitment. They are the single least reliable
            thing in the database, and the offset and width rules lean on them
            heavily. Some cars carry none at all, and for those the engine
            answers &ldquo;unknown&rdquo; rather than guessing.
          </li>
          <li className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
            <strong className="text-[var(--color-ink)]">All prices</strong> —{" "}
            <VerificationBadge level="demo" />. Invented for development. Not
            quotes, not market prices, not connected to any retailer.
          </li>
          <li className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
            <strong className="text-[var(--color-ink)]">
              Power and weight changes from parts
            </strong>{" "}
            — <VerificationBadge level="unverified" />, and the totals built from
            them are <VerificationBadge level="estimated" />. They are the part
            maker&rsquo;s own claims, measured on the maker&rsquo;s own car.
            Adding several such claims together does not produce a measurement;
            real builds show diminishing returns that the estimator does not
            model.
          </li>
          <li className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
            <strong className="text-[var(--color-ink)]">Fitment records</strong> —{" "}
            <VerificationBadge level="unverified" />. There are only a handful.
            In a real catalogue this table is the expensive part, built one
            confirmed application at a time, and its emptiness here is the
            reason so many parts show as &ldquo;unknown&rdquo;. That is an
            accurate picture of how much of an aftermarket catalogue is actually
            confirmed for any given car.
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-[17px] font-semibold tracking-tight">
          The compatibility rules
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-dim)]">
          Every verdict in the configurator comes from one of these {rules.length}{" "}
          rules. Each is a pure function of the car, the part and the rest of the
          build, and each has tests.
        </p>

        <table className="mt-4 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--color-line)]">
              <th className="py-2 pr-4 text-[11px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
                Rule
              </th>
              <th className="py-2 text-[11px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
                What it checks
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.key} className="border-b border-[var(--color-line)]">
                <td className="numeric py-2.5 pr-4 align-top text-[12px] text-[var(--color-ink)]">
                  {rule.key}
                </td>
                <td className="py-2.5 text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
                  {rule.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-10 rounded border border-[var(--color-warn)]/25 bg-[var(--color-warn-bg)] px-4 py-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-warn)]">
          Do not buy parts based on this
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-dim)]">
          A green tick here means two numbers agreed, not that anybody fitted
          this part to this car. Check the manufacturer&rsquo;s own application
          list before spending money. The point of this prototype is the
          engine and the data model; the data behind it is not yet worth
          trusting, and it says so on every screen.
        </p>
      </section>
    </main>
  );
}
