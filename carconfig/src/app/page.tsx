import { VehiclePicker } from "@/components/vehicle/VehiclePicker";
import { getCatalog } from "@/lib/catalog";

export default async function HomePage() {
  const vehicles = await getCatalog().listVehicles();

  return (
    <main className="mx-auto max-w-[1800px] px-4 py-10 sm:px-6">
      <section className="max-w-2xl">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">
          Find out what fits before you buy it.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-dim)]">
          Pick a car, add parts, and see the fitment checked against the car&apos;s
          own measurements — bolt pattern, offset, clearance, and what else is
          already in the build. Where nothing has been confirmed, it says so
          instead of guessing.
        </p>
      </section>

      <section className="mt-9">
        <VehiclePicker vehicles={vehicles} />
      </section>
    </main>
  );
}
