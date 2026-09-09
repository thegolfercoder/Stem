import type { Block, Step } from "@/lib/types";
import { M, MD, T } from "./Math";
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

const TONE: Record<string, { label: string; cls: string; icon: string }> = {
  key: {
    label: "Key idea",
    cls: "border-[color:var(--accent)]/45 bg-[color:var(--accent-soft)]",
    icon: "◆",
  },
  tip: {
    label: "Exam tip",
    cls: "border-emerald-500/40 bg-emerald-500/8",
    icon: "★",
  },
  warn: {
    label: "Watch out",
    cls: "border-amber-500/50 bg-amber-500/10",
    icon: "!",
  },
  info: {
    label: "Note",
    cls: "border-[color:var(--border)] bg-[color:var(--bg-soft)]",
    icon: "\u2139",
  },
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
        <ul className="ml-1 space-y-2">
          {b.items.map((it, i) => (
            <li key={i} className="flex gap-2.5 leading-[1.7]">
              <span aria-hidden className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
              <span>
                <T>{it}</T>
              </span>
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="ml-1 space-y-2">
          {b.items.map((it, i) => (
            <li key={i} className="flex gap-3 leading-[1.7]">
              <span
                aria-hidden
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent-soft)] text-[11px] font-semibold text-[color:var(--accent)]"
              >
                {i + 1}
              </span>
              <span>
                <T>{it}</T>
              </span>
            </li>
          ))}
        </ol>
      );
    case "note": {
      const tone = TONE[b.tone] ?? TONE.info!;
      return (
        <aside className={`rounded-xl border px-4 py-3.5 ${tone.cls}`}>
          <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em]">
            <span aria-hidden>{tone.icon}</span>
            {b.title ?? tone.label}
          </p>
          <div className="text-[0.95rem] leading-[1.7]">
            <T>{b.t}</T>
          </div>
        </aside>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={b.caption ?? "Table"}>
          <table className="w-full min-w-[22rem] border-collapse text-left text-[0.94rem]">
            {b.caption && <caption className="muted mb-2 text-left text-sm">{b.caption}</caption>}
            <thead>
              <tr className="border-b border-[color:var(--border)]">
                {b.head.map((h, i) => (
                  <th key={i} scope="col" className="py-2 pr-4 font-semibold">
                    <T>{h}</T>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-b border-[color:var(--border)]/60 last:border-0">
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
    <ol className="space-y-3.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3.5">
          <span
            aria-hidden
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--bg-soft)] text-[11px] font-semibold tabular-nums"
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="leading-[1.7]">
              <T>{s.t}</T>
            </p>
            {s.m && <MD className="mt-1">{s.m}</MD>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export { M, MD, T };
