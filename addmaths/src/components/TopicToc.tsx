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
        <p className="mb-2 font-bold">Contents</p>
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active === item.id ? "location" : undefined}
                className={`block whitespace-pre-wrap py-1 text-[0.9rem] leading-snug ${
                  active === item.id
                    ? "font-bold text-[color:var(--text)]"
                    : "text-[color:var(--accent)] hover:underline"
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
