"use client";

/** Renders a LaTeX equation, falling back to the plain-text form. */

import katex from "katex";
import { useMemo } from "react";

interface EquationProps {
  latex: string;
  /** Shown if KaTeX cannot parse the LaTeX, and used as the accessible label. */
  fallback: string;
  className?: string;
}

export function Equation({ latex, fallback, className }: EquationProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: false,
        throwOnError: true,
        strict: false,
      });
    } catch {
      return null;
    }
  }, [latex]);

  if (html === null) {
    return <span className={`numeric ${className ?? ""}`}>{fallback}</span>;
  }

  return (
    <span
      className={className}
      // KaTeX output is markup generated from our own backend's renderer, and
      // the only way to display it.
      dangerouslySetInnerHTML={{ __html: html }}
      aria-label={fallback}
      role="math"
    />
  );
}
