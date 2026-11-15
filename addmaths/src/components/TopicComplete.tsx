"use client";

import { loadProgress, saveProgress, useProgress } from "@/lib/progress";

/** Marks a topic as revised. Feeds the planner and the progress page. */
export function TopicComplete({ slug }: { slug: string }) {
  const [store, refresh] = useProgress();
  const done = store.completed.includes(slug);

  function toggle() {
    const current = loadProgress();
    const set = new Set(current.completed);
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);
    saveProgress({ ...current, completed: [...set] });
    refresh();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={done}
      className={`mt-4 inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition ${
        done
          ? "border-[color:var(--easy)]/45 bg-[color:var(--easy)]/10 text-[color:var(--easy)]"
          : "border-[color:var(--border)] hover:border-[color:var(--accent)]/50"
      }`}
    >
      <span aria-hidden>{done ? "✓" : "○"}</span>
      {done ? "Marked as revised" : "Mark as revised"}
    </button>
  );
}
