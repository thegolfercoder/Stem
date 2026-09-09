import Link from "next/link";
import type { Difficulty } from "@/lib/types";
import { DIFFICULTY_LABEL } from "@/lib/types";

const DIFF_CLASS: Record<Difficulty, string> = {
  easy: "border-[color:var(--easy)]/40 text-[color:var(--easy)] bg-[color:var(--easy)]/10",
  medium: "border-[color:var(--medium)]/40 text-[color:var(--medium)] bg-[color:var(--medium)]/10",
  hard: "border-[color:var(--hard)]/40 text-[color:var(--hard)] bg-[color:var(--hard)]/10",
  olympiad: "border-[color:var(--olympiad)]/40 text-[color:var(--olympiad)] bg-[color:var(--olympiad)]/10",
};

export function DifficultyBadge({ level }: { level: Difficulty }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] ${DIFF_CLASS[level]}`}
    >
      {DIFFICULTY_LABEL[level]}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent";
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
        tone === "accent"
          ? "border-[color:var(--accent)]/35 bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
          : "border-[color:var(--border)] bg-[color:var(--bg-soft)] text-[color:var(--text-muted)]"
      }`}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="border-b border-[color:var(--border)] pb-7">
      {eyebrow && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">
          {eyebrow}
        </p>
      )}
      <h1 className="text-[1.9rem] font-bold leading-tight sm:text-[2.4rem]">{title}</h1>
      {lead && <p className="muted mt-3 max-w-2xl text-[1.02rem] leading-relaxed">{lead}</p>}
      {children && <div className="mt-5">{children}</div>}
    </header>
  );
}

export function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 py-9">
      {title && (
        <div className="mb-5">
          <h2 className="text-xl font-bold sm:text-2xl">{title}</h2>
          {description && <p className="muted mt-1.5 max-w-2xl">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function LinkCard({
  href,
  title,
  description,
  meta,
}: {
  href: string;
  title: string;
  description: string;
  meta?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="card group flex flex-col gap-2 p-5 transition duration-200 hover:-translate-y-0.5 hover:border-[color:var(--accent)]/50"
    >
      <h3 className="font-semibold leading-snug group-hover:text-[color:var(--accent)]">{title}</h3>
      <p className="muted text-sm leading-relaxed">{description}</p>
      {meta && <div className="mt-1 flex flex-wrap gap-1.5">{meta}</div>}
    </Link>
  );
}

export function Callout({
  title,
  children,
  tone = "info",
}: {
  title?: string;
  children: React.ReactNode;
  tone?: "info" | "accent";
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3.5 ${
        tone === "accent"
          ? "border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)]"
          : "border-[color:var(--border)] bg-[color:var(--bg-soft)]"
      }`}
    >
      {title && <p className="mb-1 text-sm font-semibold">{title}</p>}
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
