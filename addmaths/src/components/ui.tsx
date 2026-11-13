import Link from "next/link";
import type { Difficulty } from "@/lib/types";
import { DIFFICULTY_LABEL } from "@/lib/types";

/** Difficulty, set as a small-caps tag in brackets, as a typeset paper would. */
export function DifficultyBadge({ level }: { level: Difficulty }) {
  return <span className="smallcaps text-[0.92em] text-[color:var(--text-muted)]">[{DIFFICULTY_LABEL[level].toLowerCase()}]</span>;
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent";
}) {
  return (
    <span className={`smallcaps text-[0.92em] ${tone === "accent" ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)]"}`}>
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
    <header className="border-b border-[color:var(--rule)] pb-7 pt-4 text-center">
      {eyebrow && (
        <p className="smallcaps mb-2 text-[0.95rem] text-[color:var(--text-muted)]">
          {eyebrow}
        </p>
      )}
      <h1 className="text-[1.85rem] font-bold leading-tight sm:text-[2.2rem]">{title}</h1>
      {lead && <p className="muted mx-auto mt-3 max-w-2xl text-[1.02rem] italic leading-relaxed">{lead}</p>}
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
      className="group flex flex-col gap-1.5 border-t border-[color:var(--border)] py-4"
    >
      <h3 className="font-bold leading-snug text-[color:var(--accent)] group-hover:underline">{title}</h3>
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
      className={`py-0.5 pl-4 ${tone === "accent" ? "border-l-2 border-[color:var(--rule)]" : "border-l border-[color:var(--border)]"}`}
    >
      {title && <p className="mb-1 text-sm font-semibold">{title}</p>}
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
