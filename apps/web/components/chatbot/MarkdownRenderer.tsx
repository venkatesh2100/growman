"use client";

import React, { useMemo } from "react";

interface MarkdownRendererProps {
  content: string;
}

type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; label: string; href: string };

/**
 * Tokenize one line of inline markdown.
 * Order: code → links → bold → italic (avoids * / ** collisions).
 */
function tokenizeInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;

  const pushText = (value: string) => {
    if (!value) return;
    const last = tokens[tokens.length - 1];
    if (last?.type === "text") {
      last.value += value;
    } else {
      tokens.push({ type: "text", value });
    }
  };

  while (i < input.length) {
    // Inline code `...`
    if (input[i] === "`") {
      const end = input.indexOf("`", i + 1);
      if (end > i) {
        tokens.push({ type: "code", value: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Links [label](url)
    if (input[i] === "[") {
      const labelEnd = input.indexOf("]", i + 1);
      if (labelEnd > i && input[labelEnd + 1] === "(") {
        const hrefEnd = input.indexOf(")", labelEnd + 2);
        if (hrefEnd > labelEnd) {
          tokens.push({
            type: "link",
            label: input.slice(i + 1, labelEnd),
            href: input.slice(labelEnd + 2, hrefEnd),
          });
          i = hrefEnd + 1;
          continue;
        }
      }
    }

    // Bold **...** or __...__
    if (
      (input[i] === "*" && input[i + 1] === "*") ||
      (input[i] === "_" && input[i + 1] === "_")
    ) {
      const marker = input.slice(i, i + 2);
      const end = input.indexOf(marker, i + 2);
      if (end > i) {
        tokens.push({ type: "bold", value: input.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // Italic *...* or _..._ (single, not part of **)
    if (
      (input[i] === "*" && input[i + 1] !== "*") ||
      (input[i] === "_" && input[i + 1] !== "_")
    ) {
      const marker = input[i]!;
      const end = input.indexOf(marker, i + 1);
      if (end > i && input[end + 1] !== marker) {
        tokens.push({ type: "italic", value: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    pushText(input[i]!);
    i += 1;
  }

  return tokens;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return tokenizeInline(text).map((token, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (token.type) {
      case "bold":
        return (
          <strong key={key} className="font-semibold text-emerald-950">
            {token.value}
          </strong>
        );
      case "italic":
        return (
          <em key={key} className="italic text-gray-800">
            {token.value}
          </em>
        );
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-emerald-50 px-1 py-0.5 font-mono text-[12px] text-emerald-700"
          >
            {token.value}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
          >
            {token.label}
          </a>
        );
      default:
        return <React.Fragment key={key}>{token.value}</React.Fragment>;
    }
  });
}

type Block =
  | { type: "blank" }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "paragraph"; text: string };

function parseBlocks(raw: string): Block[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      blocks.push({ type: "blank" });
      i += 1;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "heading", level: 3, text: trimmed.slice(4) });
      i += 1;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({ type: "heading", level: 2, text: trimmed.slice(3) });
      i += 1;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push({ type: "heading", level: 1, text: trimmed.slice(2) });
      i += 1;
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = (lines[i] ?? "").trim();
        if (!/^[-*•]\s+/.test(t)) break;
        items.push(t.replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = (lines[i] ?? "").trim();
        const m = t.match(/^\d+\.\s+(.+)$/);
        if (!m?.[1]) break;
        items.push(m[1]);
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const parts: string[] = [];
      while (i < lines.length) {
        const t = (lines[i] ?? "").trim();
        if (!t.startsWith("> ")) break;
        parts.push(t.slice(2));
        i += 1;
      }
      blocks.push({ type: "quote", text: parts.join(" ") });
      continue;
    }

    // Merge consecutive non-blank, non-special lines into one paragraph
    const parts: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = (lines[i] ?? "").trim();
      if (
        !next ||
        next.startsWith("#") ||
        /^[-*•]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        next.startsWith("> ")
      ) {
        break;
      }
      parts.push(next);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: parts.join(" ") });
  }

  return blocks;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const blocks = useMemo(() => parseBlocks(content || ""), [content]);

  if (!content?.trim()) {
    return null;
  }

  return (
    <div className="markdown-content space-y-1.5 text-[15px] leading-5 text-gray-800">
      {blocks.map((block, idx) => {
        const key = `b-${idx}`;

        switch (block.type) {
          case "blank":
            return <div key={key} className="h-1.5" />;

          case "heading": {
            const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
            const size =
              block.level === 1
                ? "text-base font-bold"
                : block.level === 2
                  ? "text-[15px] font-semibold"
                  : "text-sm font-semibold";
            return (
              <Tag key={key} className={`${size} mt-1 text-emerald-950`}>
                {renderInline(block.text, key)}
              </Tag>
            );
          }

          case "ul":
            return (
              <ul key={key} className="my-1 list-none space-y-1 pl-0">
                {block.items.map((item, itemIdx) => (
                  <li key={`${key}-${itemIdx}`} className="flex items-start gap-2">
                    <span className="mt-[2px] shrink-0 text-emerald-600" aria-hidden>
                      •
                    </span>
                    <span className="min-w-0 flex-1">{renderInline(item, `${key}-${itemIdx}`)}</span>
                  </li>
                ))}
              </ul>
            );

          case "ol":
            return (
              <ol key={key} className="my-1 list-none space-y-1 pl-0">
                {block.items.map((item, itemIdx) => (
                  <li key={`${key}-${itemIdx}`} className="flex items-start gap-2">
                    <span className="w-4 shrink-0 font-medium text-emerald-600">
                      {itemIdx + 1}.
                    </span>
                    <span className="min-w-0 flex-1">{renderInline(item, `${key}-${itemIdx}`)}</span>
                  </li>
                ))}
              </ol>
            );

          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-emerald-300 pl-3 text-sm italic text-gray-600"
              >
                {renderInline(block.text, key)}
              </blockquote>
            );

          case "paragraph":
          default:
            return (
              <p key={key} className="my-0">
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}
