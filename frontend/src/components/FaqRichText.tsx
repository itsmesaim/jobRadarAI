import type { ReactNode } from "react";

/** Render FAQ / help text: **bold**, https links, clean bullets. No raw markdown noise. */
export function FaqRichText({ text }: { text: string }) {
  const cleaned = (text || "")
    .replace(/\u2014|\u2013/g, "-") // em/en dash -> hyphen
    .replace(/^\s*[\*\-]\s+/gm, "• "); // markdown * / - bullets -> bullet

  const lines = cleaned.split("\n");
  return (
    <div className="faq-rich">
      {lines.map((line, i) => (
        <div key={i} className={`faq-rich-line${line.trim().startsWith("•") ? " is-bullet" : ""}`}>
          {renderInline(line || "\u00A0", i)}
        </div>
      ))}
    </div>
  );
}

function renderInline(line: string, lineKey: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  // [label](url) or bare https://
  const tokenRe = /(\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<]+))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = tokenRe.exec(line))) {
    if (m.index > last) nodes.push(line.slice(last, m.index));
    if (m[2]) {
      nodes.push(
        <strong key={`${lineKey}-b-${k++}`} className="faq-rich-strong">
          {m[2]}
        </strong>,
      );
    } else if (m[3] && m[4]) {
      nodes.push(
        <a
          key={`${lineKey}-a-${k++}`}
          href={m[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="faq-rich-link"
          onClick={(e) => e.stopPropagation()}
        >
          {m[3]}
        </a>,
      );
    } else if (m[5]) {
      const href = m[5].replace(/[.,;:!?)]+$/, "");
      nodes.push(
        <a
          key={`${lineKey}-u-${k++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="faq-rich-link"
          onClick={(e) => e.stopPropagation()}
        >
          {href.replace(/^https?:\/\//, "")}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  if (!nodes.length) nodes.push(line);
  return nodes;
}
