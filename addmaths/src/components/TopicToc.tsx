"use client";

import { useEffect, useState } from "react";

/**
 * A sticky contents column that tracks the section in view. It is a client
 * component only because of the scroll spy; the links themselves are plain
 * anchors and work with JavaScript switched off.
 */
export function TopicToc({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-88px 0px -70% 0px", threshold: 0 },
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="On this page" className="hidden w-56 shrink-0 lg:block">
      <div className="sticky top-24 py-8">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
          On this page
        </p>
        <ul className="space-y-0.5 border-l border-[color:var(--border)]">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active === item.id ? "location" : undefined}
                className={`-ml-px block border-l-2 py-1.5 pl-3 text-[0.82rem] leading-snug transition ${
                  active === item.id
                    ? "border-[color:var(--accent)] font-medium text-[color:var(--accent)]"
                    : "border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
                }`}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
