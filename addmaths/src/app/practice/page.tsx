import type { Metadata } from "next";
import { Suspense } from "react";
import { PracticeClient } from "@/components/PracticeClient";
import { PageHeader } from "@/components/ui";
import { GENERATORS } from "@/lib/questions";
import { TOPICS } from "@/content/topics";

export const metadata: Metadata = {
  title: "Practice questions",
  description:
    "Generate unlimited randomised IGCSE Additional Mathematics 0606 practice questions by topic and difficulty, marked instantly, with full worked solutions.",
};

export default function PracticePage() {
  const topics = TOPICS.filter((t) => t.generators.length > 0).map((t) => ({
    slug: t.slug,
    title: t.title,
    short: t.short,
    count: GENERATORS.filter((g) => g.topic === t.slug).length,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Practice"
        title="Questions that never run out"
        lead={`Every question is built fresh from ${GENERATORS.length} parameterised templates across ${topics.length} topics, marked the moment you answer, with the full reasoning available either way.`}
      />
      <Suspense fallback={<p className="muted py-10">Loading the practice engine…</p>}>
        <PracticeClient topics={topics} />
      </Suspense>
    </>
  );
}
