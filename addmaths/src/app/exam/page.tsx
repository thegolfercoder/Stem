import type { Metadata } from "next";
import { ExamClient } from "@/components/ExamClient";
import { PageHeader } from "@/components/ui";
import { TOPICS } from "@/content/topics";
import { GENERATORS } from "@/lib/questions";

export const metadata: Metadata = {
  title: "Exam simulator",
  description:
    "Sit a timed IGCSE Additional Mathematics 0606 paper: question navigation, automatic marking, time per question and a topic-by-topic performance breakdown.",
};

export default function ExamPage() {
  const topicNames = Object.fromEntries(TOPICS.map((t) => [t.slug, t.short]));
  const paperCounts = {
    1: GENERATORS.filter((g) => g.paper === 1).length,
    2: GENERATORS.filter((g) => g.paper === 2).length,
  };
  return (
    <>
      <PageHeader
        eyebrow="Exam simulator"
        title="Sit a paper against the clock"
        lead="The real thing is two papers of two hours and eighty marks each — Paper 1 without a calculator, Paper 2 with one. Choose a length, work through it under time, and get a full breakdown at the end."
      />
      <ExamClient topicNames={topicNames} paperCounts={paperCounts} />
    </>
  );
}
