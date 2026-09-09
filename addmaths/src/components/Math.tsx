import katex from "katex";

/**
 * Maths is rendered to HTML on the server, at build time. The reader gets
 * typeset equations in the first paint with no layout shift and no KaTeX
 * bundle to download — only the stylesheet.
 */

function render(tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    strict: false,
    trust: false,
    output: "html",
    macros: {
      "\\dd": "\\,\\mathrm{d}",
      "\\deriv": "\\dfrac{\\mathrm{d}#1}{\\mathrm{d}#2}",
      "\\vect": "\\begin{pmatrix}#1\\\\#2\\end{pmatrix}",
    },
  });
}

export function M({ children }: { children: string }) {
  return (
    <span
      className="inline-block align-baseline"
      dangerouslySetInnerHTML={{ __html: render(children, false) }}
    />
  );
}

export function MD({ children, className }: { children: string; className?: string }) {
  // tabIndex makes the horizontally scrollable equation reachable by keyboard,
  // which is what WCAG 2.1 asks of any scrollable region.
  return (
    <div
      className={className}
      tabIndex={0}
      role="group"
      aria-label="Equation"
      dangerouslySetInnerHTML={{ __html: render(children, true) }}
    />
  );
}

/**
 * Text with inline maths between single dollars, e.g.
 * "Solve $x^2 = 9$ for $x$." A literal dollar is written `\$`.
 */
export function T({ children }: { children: string }) {
  return <>{parseInline(children)}</>;
}

export function parseInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let buf = "";
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\" && text[i + 1] === "$") {
      buf += "$";
      i += 2;
      continue;
    }
    if (ch === "$") {
      const end = findClose(text, i + 1);
      if (end === -1) {
        buf += ch;
        i += 1;
        continue;
      }
      if (buf) {
        out.push(...emphasise(buf, key));
        key += 1;
        buf = "";
      }
      out.push(<M key={`m${key++}`}>{text.slice(i + 1, end)}</M>);
      i = end + 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf) out.push(...emphasise(buf, key));
  return out;
}

function findClose(text: string, from: number): number {
  for (let j = from; j < text.length; j += 1) {
    if (text[j] === "\\") {
      j += 1;
      continue;
    }
    if (text[j] === "$") return j;
  }
  return -1;
}

/** Minimal emphasis so prose can carry **bold** without a markdown parser. */
function emphasise(chunk: string, keyBase: number): React.ReactNode[] {
  const parts = chunk.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, idx) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={`b${keyBase}-${idx}`} className="font-semibold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={`t${keyBase}-${idx}`}>{p}</span>
    ),
  );
}
