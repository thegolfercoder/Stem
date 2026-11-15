"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("addmaths-theme", next ? "dark" : "light");
    } catch {
      /* private browsing: the choice simply does not persist */
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark ?? false}
      className="rounded-lg border border-[color:var(--border)] p-2 transition hover:bg-[color:var(--bg-soft)]"
    >
      <span className="sr-only">
        {dark ? "Switch to light theme" : "Switch to dark theme"}
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
        <g className="hidden dark:block">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4" strokeLinecap="round" />
        </g>
        <path className="dark:hidden" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
