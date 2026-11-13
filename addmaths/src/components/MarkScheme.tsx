import type { MarkItem } from "@/lib/types";
import { T } from "./Math";

const TYPE_NAME: Record<MarkItem["type"], string> = {
  M: "Method mark: earned for a correct method, even if an arithmetic slip follows.",
  A: "Accuracy mark: earned for a correct result, and only if the method mark it depends on was earned.",
  B: "Independent mark: earned for a correct statement or value, whatever the method.",
};

/**
 * A Cambridge-style mark scheme, set as a booktabs table. M marks reward
 * method, A marks reward accuracy that follows from that method, and B marks
 * stand alone, which is why a wrong final answer can still score most marks.
 */
export function MarkScheme({ items, total }: { items: MarkItem[]; total: number }) {
  if (!items.length) return null;
  return (
    <div className="mt-4 overflow-x-auto" tabIndex={0} role="group" aria-label="How the marks are awarded">
      <table className="w-full min-w-[20rem] border-collapse text-left text-[0.95rem]">
        <caption className="caption-top pb-1.5 text-left">
          <span className="tex-italic-label">How the marks are awarded.</span>{" "}
          <span className="muted text-sm">Total {total}. M method, A accuracy, B independent.</span>
        </caption>
        <thead>
          <tr>
            <th scope="col" className="py-1 pr-4 font-semibold">Part</th>
            <th scope="col" className="py-1 pr-4 font-semibold">Mark</th>
            <th scope="col" className="py-1 font-semibold">Awarded for</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              <td className="py-1 pr-4 align-top">{item.part ?? ""}</td>
              <td className="py-1 pr-4 align-top tabular-nums">
                <abbr title={TYPE_NAME[item.type]} className="no-underline">
                  {item.type}
                  {item.marks}
                </abbr>
              </td>
              <td className="py-1 align-top leading-relaxed">
                <T>{item.criterion}</T>
                {item.dependsOn !== undefined && items[item.dependsOn] ? (
                  <span className="muted"> (dep. on the {items[item.dependsOn]!.type} mark)</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
