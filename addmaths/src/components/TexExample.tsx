import type { Difficulty, MarkItem, PlotSpec, Step } from "@/lib/types";
import { Steps } from "./Blocks";
import { MarkScheme } from "./MarkScheme";
import { T } from "./Math";
import { Plot } from "./Plot";
import { DifficultyBadge } from "./ui";

/**
 * A worked example set like an amsthm environment:
 *
 *   Example 3.2 (Completing the square) [medium].  The question…
 *   Solution.  (1) … (2) …                                        □
 *
 * The solution folds away so a reader can attempt the question first.
 */
export function TexExample({
  id,
  label,
  title,
  difficulty,
  prompt,
  figure,
  steps,
  answer,
  remark,
  marks,
  paper,
  scheme,
  open = false,
}: {
  id?: string;
  label: string;
  title: string;
  difficulty: Difficulty;
  prompt: string;
  figure?: PlotSpec;
  steps: Step[];
  answer: string;
  remark?: string;
  marks?: number;
  paper?: 1 | 2;
  scheme?: MarkItem[];
  open?: boolean;
}) {
  const lines = prompt.split("\n");
  return (
    <div id={id} className="scroll-mt-24 border-t border-[color:var(--border)] py-5 first:border-t-0">
      <p className="leading-[1.7]">
        <span className="tex-label">{label}</span> (<T>{title}</T>) <DifficultyBadge level={difficulty} />
        {marks ? (
          <span className="smallcaps text-[0.92em] text-[color:var(--text-muted)]">
            {" "}
            [{marks} marks{paper ? `, paper ${paper}` : ""}]
          </span>
        ) : null}
        <span className="tex-label">.</span> <T>{lines[0] ?? ""}</T>
      </p>
      {lines.slice(1).map((line, i) =>
        line.trim() ? (
          <p key={i} className="mt-1 leading-[1.7]">
            <T>{line}</T>
          </p>
        ) : null,
      )}
      {figure && <Plot spec={figure} />}
      <details className="group mt-3" open={open}>
        <summary className="cursor-pointer list-none text-[color:var(--accent)] underline decoration-1 underline-offset-[3px]">
          <span className="group-open:hidden">Show solution</span>
          <span className="hidden group-open:inline">Hide solution</span>
        </summary>
        <div className="mt-3">
          <p className="tex-italic-label mb-2">Solution.</p>
          <Steps steps={steps} />
          <p className="qed mt-3 leading-[1.7]">
            <span className="tex-label">Answer.</span> <T>{answer}</T>
          </p>
          {remark && (
            <p className="mt-3 leading-[1.7]">
              <span className="tex-italic-label">Remark.</span> <T>{remark}</T>
            </p>
          )}
          {scheme && marks ? <MarkScheme items={scheme} total={marks} /> : null}
        </div>
      </details>
    </div>
  );
}
