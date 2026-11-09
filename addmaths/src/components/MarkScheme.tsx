import type { MarkItem } from "@/lib/types";
import { T } from "./Math";

const TYPE_NAME: Record<MarkItem["type"], string> = {
  M: "Method mark: earned for a correct method, even if an arithmetic slip follows.",
  A: "Accuracy mark: earned for a correct result, and only if the method mark it depends on was earned.",
  B: "Independent mark: earned for a correct statement or value, whatever the method.",
};

/**
 * A Cambridge-style mark scheme. M marks reward method, A marks reward
 * accuracy that follows from that method, and B marks stand alone, which is
 * why a wrong final answer can still score most of the marks.
 */
export function MarkScheme({ items, total }: { items: MarkItem[]; total: number }) {
  if (!items.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-[color:var(--border)] p-4">
      <p className="text-sm font-semibold">How the marks are awarded</p>
      <ol className="mt-2 space-y-1.5 text-sm">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3">
            <abbr
              title={TYPE_NAME[item.type]}
              className="w-10 shrink-0 font-mono font-semibold no-underline tabular-nums"
            >
              {item.part ? `${item.part} ` : ""}
              {item.type}
              {item.marks}
            </abbr>
            <span className="leading-relaxed">
              <T>{item.criterion}</T>
              {item.dependsOn !== undefined && items[item.dependsOn] ? (
                <span className="muted"> (depends on the {items[item.dependsOn]!.type} mark)</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <p className="muted mt-2 text-xs">
        Total {total} mark{total === 1 ? "" : "s"}. M = method, A = accuracy, B = independent.
      </p>
    </div>
  );
}
