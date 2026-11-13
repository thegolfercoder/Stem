import type { Block, Step } from "@/lib/types";
import { M, MD, T, plainText } from "./Math";
import { Plot } from "./Plot";

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="prose-math space-y-4">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

/** Notes read like amsthm environments: a bold run-in label, then the text. */
const TONE: Record<string, { label: string; cls: string }> = {
  key: { label: "Key idea", cls: "border-l-2 border-[color:var(--rule)]" },
  tip: { label: "Exam tip", cls: "border-l border-[color:var(--border)]" },
  warn: { label: "Caution", cls: "border-l-2 border-[color:var(--hard)]" },
  info: { label: "Remark", cls: "border-l border-[color:var(--border)]" },
};

function BlockView({ block: b }: { block: Block }) {
  switch (b.k) {
    case "p":
      return (
        <p className="leading-[1.75]">
          <T>{b.t}</T>
        </p>
      );
    case "math":
      return <MD className="my-4">{b.t}</MD>;
    case "ul":
      return (
        <ul className="ml-6 list-disc space-y-1.5 marker:text-[color:var(--text)]">
          {b.items.map((it, i) => (
            <li key={i} className="pl-1 leading-[1.7]">
              <T>{it}</T>
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="ml-7 list-[lower-roman] space-y-1.5">
          {b.items.map((it, i) => (
            <li key={i} className="pl-1 leading-[1.7]">
              <T>{it}</T>
            </li>
          ))}
        </ol>
      );
    case "note": {
      const tone = TONE[b.tone] ?? TONE.info!;
      return (
        <aside className={`py-0.5 pl-4 ${tone.cls}`}>
          <p className="leading-[1.7]">
            <span className="tex-label">{b.title ? <T>{b.title}</T> : tone.label}.</span>{" "}
            <T>{b.t}</T>
          </p>
        </aside>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={b.caption ? plainText(b.caption) : "Table"}>
          <table className="w-full min-w-[22rem] border-collapse text-left text-[0.94rem]">
            {b.caption && (
              <caption className="caption-bottom pt-2 text-center text-sm">
                <span className="tex-label">Table.</span>{" "}
                <T>{b.caption}</T>
              </caption>
            )}
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} scope="col" className="py-2 pr-4 font-semibold">
                    {h.includes("$") ? (
                      <>
                        {/* Rendered maths is not read as a header name, so give it words. */}
                        <span className="sr-only">{plainText(h) || "Column"}</span>
                        <span aria-hidden="true">
                          <T>{h}</T>
                        </span>
                      </>
                    ) : (
                      <T>{h}</T>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="py-2 pr-4 align-top">
                      <T>{c}</T>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "steps":
      return <Steps steps={b.items} />;
    case "plot":
      return <Plot spec={b.spec} />;
    case "columns":
      return (
        <div className="grid gap-5 md:grid-cols-2">
          <Blocks blocks={b.left} />
          <Blocks blocks={b.right} />
        </div>
      );
  }
}

export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className="w-7 shrink-0 pt-px text-right tabular-nums text-[color:var(--text-muted)]">
            ({i + 1})
          </span>
          <div className="min-w-0 flex-1">
            <p className="leading-[1.7]">
              <T>{s.t}</T>
            </p>
            {s.m && <MD className="mt-0.5">{s.m}</MD>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export { M, MD, T };
