"use client";

import { rankFindings } from "@/lib/compatibility/engine";
import { StatusBadge, VerificationBadge } from "@/components/ui/badges";
import type { CompatibilityResult, Finding } from "@/types/compatibility";

/**
 * Why a part got the verdict it got.
 *
 * This is the screen that justifies building a rules engine instead of a
 * lookup table, so it shows the reasoning rather than summarising it: the
 * rule, the sentence, and the two numbers that were compared. Passing checks
 * are shown too — knowing that the bolt pattern was checked and matched is
 * worth as much as knowing it failed.
 */

export function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className="flex gap-3 border-t border-[var(--color-line)] py-2.5 first:border-t-0">
      <div className="mt-[1px] shrink-0">
        <StatusBadge
          status={finding.status}
          label={finding.advisory ? "Note" : undefined}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--color-ink)]">
            {finding.title}
          </span>
          {finding.provenance ? (
            <VerificationBadge
              level={finding.provenance.verification}
              note={finding.provenance.note}
            />
          ) : null}
        </div>

        <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
          {finding.detail}
        </p>

        {finding.evidence ? (
          <dl className="numeric mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-ink-faint)]">
            {Object.entries(finding.evidence).map(([key, value]) => (
              <div key={key} className="flex gap-1.5">
                <dt>{humanizeKey(key)}</dt>
                <dd className="text-[var(--color-ink-dim)]">{String(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </li>
  );
}

export function FindingList({
  result,
  emptyMessage = "Nothing was checked for this part.",
}: {
  result: CompatibilityResult;
  emptyMessage?: string;
}) {
  const findings = rankFindings(result.findings);

  if (findings.length === 0) {
    return (
      <p className="py-3 text-[12px] text-[var(--color-ink-dim)]">{emptyMessage}</p>
    );
  }

  return (
    <ul>
      {findings.map((finding, i) => (
        <FindingRow key={`${finding.ruleKey}-${finding.axle ?? ""}-${i}`} finding={finding} />
      ))}
    </ul>
  );
}

/** wheelOffsetMm → "wheel offset mm" */
function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
}
