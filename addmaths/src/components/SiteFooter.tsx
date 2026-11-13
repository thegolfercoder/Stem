import Link from "next/link";
import { NAV, SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-[color:var(--border)] bg-[color:var(--bg-soft)]">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-semibold">{SITE.name}</p>
            <p className="muted mt-2 max-w-xs text-sm leading-relaxed">
              A complete, free revision course for Cambridge IGCSE Additional
              Mathematics 0606, written for the {SITE.syllabusYears} syllabus.
            </p>
          </div>
          <nav aria-label="Study" className="text-sm">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              Study
            </p>
            <ul className="space-y-1.5">
              {NAV.slice(1, 6).map((n) => (
                <li key={n.href}>
                  <Link className="hover:text-[color:var(--accent)]" href={n.href}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Practise" className="text-sm">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              Practise
            </p>
            <ul className="space-y-1.5">
              {NAV.slice(6).map((n) => (
                <li key={n.href}>
                  <Link className="hover:text-[color:var(--accent)]" href={n.href}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="text-sm">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              About
            </p>
            <p className="muted leading-relaxed">
              Content follows the published Cambridge 0606 syllabus for{" "}
              {SITE.syllabusYears}. This is an independent study resource and is
              not endorsed by or affiliated with Cambridge Assessment
              International Education. Questions here are written in the style
              of the papers, not reproduced from them.
            </p>
          </div>
        </div>
        <p className="muted mt-9 border-t border-[color:var(--border)] pt-5 text-xs">
          Your practice history and progress are stored only in this browser.
          Nothing is uploaded anywhere.
        </p>
      </div>
    </footer>
  );
}
