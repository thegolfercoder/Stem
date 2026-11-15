import Link from "next/link";
import { NAV } from "@/lib/site";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">
        404
      </p>
      <h1 className="mt-3 text-3xl font-bold">That page does not exist</h1>
      <p className="muted mx-auto mt-3 max-w-md leading-relaxed">
        The link may be out of date. Everything on the site is reachable from the pages below, or
        through search — press Ctrl K.
      </p>
      <nav aria-label="Main pages" className="mt-8 flex flex-wrap justify-center gap-2">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm font-medium transition hover:border-[color:var(--accent)]/50"
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
