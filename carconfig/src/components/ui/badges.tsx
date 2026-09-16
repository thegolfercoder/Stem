import type { CompatibilityStatus } from "@/types/compatibility";
import { STATUS_LABELS } from "@/types/compatibility";
import type { VerificationLevel } from "@/types/provenance";
import {
  VERIFICATION_DESCRIPTIONS,
  VERIFICATION_LABELS,
} from "@/types/provenance";

/**
 * The two badges the whole product leans on.
 *
 * Compatibility status and data confidence are shown as separate marks on
 * purpose. They answer different questions — "does it fit" and "how do we
 * know" — and a product that merges them into one green tick is exactly the
 * product this one is trying not to be.
 */

const STATUS_STYLES: Record<CompatibilityStatus, string> = {
  compatible: "text-[var(--color-ok)] bg-[var(--color-ok-bg)] border-[var(--color-ok)]/30",
  requires_modification:
    "text-[var(--color-warn)] bg-[var(--color-warn-bg)] border-[var(--color-warn)]/30",
  unknown:
    "text-[var(--color-unknown)] bg-[var(--color-unknown-bg)] border-[var(--color-unknown)]/30",
  incompatible:
    "text-[var(--color-bad)] bg-[var(--color-bad-bg)] border-[var(--color-bad)]/30",
};

/** A filled dot, so status is legible without relying on colour alone. */
const STATUS_GLYPHS: Record<CompatibilityStatus, string> = {
  compatible: "✓",
  requires_modification: "!",
  unknown: "?",
  incompatible: "✕",
};

export function StatusBadge({
  status,
  size = "sm",
  label,
}: {
  status: CompatibilityStatus;
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded border font-medium ${
        STATUS_STYLES[status]
      } ${size === "md" ? "px-2.5 py-1 text-[12px]" : "px-2 py-0.5 text-[11px]"}`}
    >
      <span aria-hidden className="font-bold">
        {STATUS_GLYPHS[status]}
      </span>
      {label ?? STATUS_LABELS[status]}
    </span>
  );
}

const VERIFICATION_STYLES: Record<VerificationLevel, string> = {
  verified: "text-[var(--color-ok)] border-[var(--color-ok)]/25",
  unverified: "text-[var(--color-ink-dim)] border-[var(--color-line-bright)]",
  estimated: "text-[var(--color-warn)] border-[var(--color-warn)]/25",
  demo: "text-[var(--color-unknown)] border-[var(--color-unknown)]/25",
};

export function VerificationBadge({
  level,
  note,
}: {
  level: VerificationLevel;
  note?: string;
}) {
  return (
    <span
      title={note ? `${VERIFICATION_DESCRIPTIONS[level]} ${note}` : VERIFICATION_DESCRIPTIONS[level]}
      className={`inline-flex shrink-0 cursor-help items-center rounded border px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-[0.08em] ${VERIFICATION_STYLES[level]}`}
    >
      {VERIFICATION_LABELS[level]}
    </span>
  );
}

/** A labelled figure. The workhorse of every spec panel in the app. */
export function Stat({
  label,
  value,
  unit,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
        {label}
      </div>
      <div
        className={`numeric mt-0.5 ${
          emphasis ? "text-[19px] text-[var(--color-ink)]" : "text-[15px] text-[var(--color-ink)]"
        }`}
      >
        {value}
        {unit ? (
          <span className="ml-1 text-[11px] text-[var(--color-ink-faint)]">{unit}</span>
        ) : null}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">{hint}</div>
      ) : null}
    </div>
  );
}
