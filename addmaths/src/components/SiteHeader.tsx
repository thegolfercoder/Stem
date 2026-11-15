"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV, PRIMARY_NAV, SITE } from "@/lib/site";
import { ThemeToggle } from "./ThemeToggle";
import { SearchDialog } from "./SearchDialog";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !isTyping(e.target))) {
        e.preventDefault();
        setSearch(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const primary = NAV.filter((n) => PRIMARY_NAV.includes(n.href));

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[color:var(--rule)] bg-[color:var(--bg)]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="smallcaps shrink-0 text-[1.05rem] font-bold">
            {SITE.name}
          </Link>

          <nav aria-label="Main" className="ml-2 hidden items-center gap-1 lg:flex">
            {primary.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href.replace(/\/$/, "") + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`px-2.5 py-2 text-[0.95rem] ${
                    active ? "font-bold underline underline-offset-4" : "hover:underline hover:underline-offset-4"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearch(true)}
              className="flex items-center gap-2 border border-[color:var(--border)] px-3 py-1.5 text-sm text-[color:var(--text-muted)] hover:border-[color:var(--rule)]"
            >
              <SearchIcon />
              <span className="hidden sm:inline">Search</span>
              <kbd className="ml-1 hidden rounded border border-[color:var(--border)] px-1.5 py-px font-sans text-[10px] md:inline">
                Ctrl K
              </kbd>
            </button>
            <ThemeToggle />
            <button
              type="button"
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen((v) => !v)}
              className="rounded-lg border border-[color:var(--border)] p-2 transition hover:bg-[color:var(--bg-soft)]"
            >
              <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
              <MenuIcon open={open} />
            </button>
          </div>
        </div>

        {open && (
          <div
            id="site-menu"
            className="border-t border-[color:var(--border)] bg-[color:var(--bg)]"
          >
            <nav
              aria-label="All pages"
              className="mx-auto grid w-full max-w-6xl gap-1 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3"
            >
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-2.5 transition hover:bg-[color:var(--bg-soft)]"
                >
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="muted block text-xs">{item.description}</span>
                </Link>
              ))}
            </nav>
          </div>
        )}
      </header>
      {search && <SearchDialog onClose={() => setSearch(false)} />}
    </>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      {open ? (
        <>
          <path d="M5 5l14 14" />
          <path d="M19 5L5 19" />
        </>
      ) : (
        <>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </>
      )}
    </svg>
  );
}
