import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ProgressClient } from "@/components/ProgressClient";
import { TOPICS } from "@/content/topics";

export const metadata: Metadata = {
  title: "Your progress",
  description:
    "Accuracy by topic and difficulty, your weak areas, exam history and a retry queue — all stored privately in your own browser.",
};

export default function ProgressPage() {
  const topicNames = Object.fromEntries(TOPICS.map((t) => [t.slug, t.short]));
  return (
    <>
      <PageHeader
        eyebrow="Progress"
        title="What to revise next"
        lead="Every question you answer is recorded here, in this browser only. The point is not the numbers — it is the ranked list of topics at the bottom."
      />
      <ProgressClient topicNames={topicNames} totalTopics={TOPICS.length} />
    </>
  );
}
