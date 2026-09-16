import type { Metadata } from "next";
import { SavedBuilds } from "@/components/build/SavedBuilds";
import { getCatalog } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Saved builds",
  description: "Builds saved in this browser.",
};

export default async function BuildsPage() {
  const vehicles = await getCatalog().listVehicles();

  return (
    <main className="mx-auto max-w-[1800px] px-4 py-10 sm:px-6">
      <header className="max-w-2xl">
        <h1 className="text-[24px] font-semibold tracking-tight">Saved builds</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-dim)]">
          Builds are saved in this browser. There are no accounts yet, so
          nothing is uploaded anywhere — which also means a build does not
          follow you to another device, and clearing your browser data will
          remove it. Use a share link to move a build somewhere else.
        </p>
      </header>

      <div className="mt-8">
        <SavedBuilds vehicles={vehicles} />
      </div>
    </main>
  );
}
