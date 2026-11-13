import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ToolsClient } from "@/components/ToolsClient";

export const metadata: Metadata = {
  title: "Calculators and tools",
  description:
    "Interactive tools for IGCSE Additional Mathematics 0606: a graph plotter, quadratic and discriminant solver, binomial term finder, radian converter, progression calculator and derivative checker.",
};

export default function ToolsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Tools"
        title="Check your work, and see the shape of it"
        lead="Six tools for the calculations that are slow by hand. Use them to check answers and build intuition — not as a substitute for the method, which is what the marks are for."
      />
      <ToolsClient />
    </>
  );
}
