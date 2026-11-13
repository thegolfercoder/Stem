import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { PlannerClient } from "@/components/PlannerClient";
import { TOPICS } from "@/content/topics";

export const metadata: Metadata = {
  title: "Revision planner",
  description:
    "Build a personal revision schedule for IGCSE Additional Mathematics 0606 that covers every topic before your exam date, and track what you have finished.",
};

export default function PlannerPage() {
  const topics = TOPICS.map((t) => ({
    slug: t.slug,
    title: t.title,
    short: t.short,
    minutes: t.estimatedMinutes,
    unit: t.unit,
  }));
  return (
    <>
      <PageHeader
        eyebrow="Revision planner"
        title="A schedule that actually reaches your exam"
        lead="Enter your exam date and how long you can study each week. The planner spreads all 22 topics across the time you have, in an order that respects what depends on what."
      />
      <PlannerClient topics={topics} />
    </>
  );
}
