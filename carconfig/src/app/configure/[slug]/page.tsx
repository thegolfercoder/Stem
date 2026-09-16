import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Configurator } from "@/components/configurator/Configurator";
import { getCatalog } from "@/lib/catalog";
import { vehicleFullName } from "@/types/vehicle";

/**
 * The configurator route.
 *
 * The catalogue is read on the server and handed to the client component as
 * props. With fifteen cars and forty parts that is a few kilobytes and buys a
 * configurator that responds instantly to every click, with no loading state
 * between choosing a part and seeing its verdict. When the catalogue is large
 * enough that this stops being true, the part list becomes a server-driven
 * search and this is the file that changes.
 */

export async function generateStaticParams() {
  const vehicles = await getCatalog().listVehicles();
  return vehicles.map((v) => ({ slug: v.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const vehicle = await getCatalog().getVehicleBySlug(slug);
  if (!vehicle) return { title: "Vehicle not found" };

  return {
    title: `Configure ${vehicleFullName(vehicle)}`,
    description: `Build and check parts against a ${vehicleFullName(vehicle)}.`,
  };
}

export default async function ConfigurePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const catalog = getCatalog();

  const vehicle = await catalog.getVehicleBySlug(slug);
  if (!vehicle) notFound();

  const [parts, fitment] = await Promise.all([
    catalog.listParts(),
    catalog.getFitmentForVehicle(vehicle.id),
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
