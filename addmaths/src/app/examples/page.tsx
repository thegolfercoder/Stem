import type { Metadata } from "next";
import Link from "next/link";
import { TOPICS } from "@/content/topics";
import { DIFFICULTY_LABEL } from "@/lib/types";
import { questionTypes } from "@/lib/questions/gallery";
import { T } from "@/components/Math";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "List of worked examples",
  description:
    "An index of every worked example on the site and a worked instance of every type of question the practice engine sets, each solved step by step.",
};

/**
 * A list of examples in the manner of \listoffigures: every written example
 * and every worked question type, numbered as on its topic page, with a link
 * to the full solution there.
 */
export default function ExamplesPage() {
  const rows = TOPICS.map((topic) => {
    const k = topic.sections.length;
    return { topic, k, types: questionTypes(topic.generators) };
  });
  const written = rows.reduce((n, r) => n + r.topic.examples.length, 0);
  const typed = rows.reduce((n, r) => n + r.types.reduce((m, t) => m + t.instances.length, 0), 0);
  const kinds = rows.reduce((n, r) => n + r.types.length, 0);

  return (
    <>
      <PageHeader
        eyebrow="Index"
        title="List of worked examples"
        lead={`${written} written examples, and ${typed} worked instances covering all ${kinds} question types the practice engine sets, each method separately. Every entry links to its full solution.`}
      />

      <div className="mx-auto max-w-3xl py-8">
        {rows.map(({ topic, k, types }, ti) => (
          <section key={topic.slug} id={topic.slug} className="scroll-mt-24 py-4" aria-labelledby={`${topic.slug}-h`}>
            <h2 id={`${topic.slug}-h`} className="text-[1.15rem] font-bold">
              {ti + 1}&ensp;
              <Link href={`/topics/${topic.slug}/`} className="link">
                {topic.title}
              </Link>
            </h2>
            <ol className="mt-1.5">
              {topic.examples.map((ex, i) => (
                <Entry
                  key={ex.id}
                  href={`/topics/${topic.slug}/#${ex.id}`}
                  label={`Example ${k + 2}.${i + 1}`}
                  title={ex.title}
                  note={DIFFICULTY_LABEL[ex.difficulty].toLowerCase()}
                />
              ))}
              {types.flatMap((t, i) =>
                t.instances.map((q, qi) => (
                  <Entry
                    key={q.id}
                    href={`/topics/${topic.slug}/#type-${t.generator}-${qi + 1}`}
                    label={`Type ${k + 3}.${i + 1}${t.instances.length > 1 ? String.fromCharCode(97 + qi) : ""}`}
                    title={t.instances.length > 1 ? `${t.title}, variant ${qi + 1}` : t.title}
                    note={DIFFICULTY_LABEL[q.difficulty].toLowerCase()}
                  />
                )),
              )}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}

function Entry({ href, label, title, note }: { href: string; label: string; title: string; note: string }) {
  return (
    <li className="flex items-baseline gap-2 py-0.5 pl-6">
      <span className="w-[6.5rem] shrink-0 tabular-nums">{label}</span>
      <Link href={href} className="link min-w-0">
        <T>{title}</T>
      </Link>
      <span aria-hidden className="min-w-4 flex-1 border-b border-dotted border-[color:var(--border)]" />
      <span className="smallcaps shrink-0 text-[color:var(--text-muted)]">{note}</span>
    </li>
  );
}
