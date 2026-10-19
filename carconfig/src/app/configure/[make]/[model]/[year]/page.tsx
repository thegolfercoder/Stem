import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Configurator } from "@/components/configurator/Configurator";
import { getCatalog } from "@/lib/catalog";
import { catalogVehicleName } from "@/types/vehicle";

/**
 * The configurator route.
 *
 * Addressed by make/model/year rather than by a single slug, because the
 * catalogue holds ten thousand model-years and a flat slug space stops being
 * navigable long before that. Nothing is prerendered for the same reason: a
 * build that emits ten thousand static pages takes minutes and serves almost
 * all of them to nobody. These render on demand and cache.
 */

interface RouteParams {
  params: Promise<{ make: string; model: string; year: string }>;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { make, model, year } = await params;
  const vehicle = await getCatalog().getVehicle(make, model, Number(year));
  if (!vehicle) return { title: "Vehicle not found" };

  const name = catalogVehicleName(vehicle);
  return {
    title: `Configure ${name}`,
    description: vehicle.profile
      ? `Build and check parts against a ${name}, with fitment checked against the car's own measurements.`
      : `Build a ${name}. No fitment data is recorded for this car yet, so parts are reported as unknown rather than guessed at.`,
  };
}

export default async function ConfigurePage({ params }: RouteParams) {
  const { make, model, year } = await params;
  const parsedYear = Number(year);
  if (!Number.isInteger(parsedYear)) notFound();

  const catalog = getCatalog();
  const vehicle = await catalog.getVehicle(make, model, parsedYear);
  if (!vehicle) notFound();

  const [parts, fitment] = await Promise.all([
    catalog.listParts(),
    catalog.getFitmentForVehicle(vehicle.profile?.id ?? vehicle.key),
  ]);

  return (
    <main>
      <Configurator
        vehicle={vehicle}
        catalogue={parts}
        fitmentRecords={[...fitment.values()]}
      />
    </main>
  );
}
