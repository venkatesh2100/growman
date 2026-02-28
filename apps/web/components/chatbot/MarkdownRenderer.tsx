"use client";

import React from "react";

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // Simple markdown parser for common formatting
  const parseMarkdown = (text: string): React.ReactNode[] => {
    // Split by lines to handle headers and lists
    const lines = text.split('\n');
    
    return lines.map((line, lineIndex) => {
      const lineKey = `line-${lineIndex}`;
      const trimmedLine = line.trim();
      
      // Empty line
      if (!trimmedLine) {
        return <br key={lineKey} />;
      }
      
      // Headers (###, ##, #)
      if (trimmedLine.startsWith('### ')) {
        return (
          <h3 key={lineKey} className="text-sm font-semibold mt-2 mb-1 text-gray-900">
            {parseInlineMarkdown(trimmedLine.substring(4))}
          </h3>
        );
      }
      if (trimmedLine.startsWith('## ')) {
        return (
          <h2 key={lineKey} className="text-base font-semibold mt-2 mb-1 text-gray-900">
            {parseInlineMarkdown(trimmedLine.substring(3))}
          </h2>
        );
      }
      if (trimmedLine.startsWith('# ')) {
        return (
          <h1 key={lineKey} className="text-base font-bold mt-2 mb-1 text-gray-900">
            {parseInlineMarkdown(trimmedLine.substring(2))}
          </h1>
        );
      }
      
      // Numbered lists (1. 2. etc)
      const numberedListMatch = trimmedLine.match(/^(\d+)\.\s+(.+)$/);
      if (numberedListMatch && numberedListMatch[2]) {
        return (
          <div key={lineKey} className="flex items-start gap-2 my-1">
            <span className="text-emerald-600 font-medium">{numberedListMatch[1]}.</span>
            <span className="text-sm">{parseInlineMarkdown(numberedListMatch[2])}</span>
          </div>
        );
      }
      
      // Bullet lists (- or *)
      if (trimmedLine.match(/^[-*]\s+/)) {
        const listContent = trimmedLine.replace(/^[-*]\s+/, '');
        return (
          <div key={lineKey} className="flex items-start gap-2 my-1">
            <span className="text-emerald-600">•</span>
            <span className="text-sm">{parseInlineMarkdown(listContent)}</span>
          </div>
        );
      }
      
      // Regular paragraph
      return (
        <p key={lineKey} className="text-sm my-1">
          {parseInlineMarkdown(trimmedLine)}
        </p>
      );
    });
  };

  // Parse inline markdown (bold, italic, code)
  const parseInlineMarkdown = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let key = 0;

    // Process in order: bold first (to avoid conflicts with italic), then code, then italic
    // Use a more sophisticated approach to avoid overlapping matches
    const processedIndices = new Set<number>();
    const matches: Array<{ index: number; length: number; component: React.ReactNode; endIndex: number }> = [];

    // First, find all bold matches (**text**)
    const boldRegex = /\*\*(.+?)\*\*/g;
    let boldMatch;
    while ((boldMatch = boldRegex.exec(text)) !== null) {
      const start = boldMatch.index;
      const end = start + boldMatch[0].length;
      // Mark all indices in this range as processed
      for (let i = start; i < end; i++) {
        processedIndices.add(i);
      }
      matches.push({
        index: start,
        length: boldMatch[0].length,
        endIndex: end,
        component: <strong key={`bold-${key++}`} className="font-semibold">{boldMatch[1]}</strong>,
      });
    }

    // Then find code matches (`text`)
    const codeRegex = /`(.+?)`/g;
    let codeMatch;
    while ((codeMatch = codeRegex.exec(text)) !== null) {
      const start = codeMatch.index;
      const end = start + codeMatch[0].length;
      // Check if this range overlaps with any processed indices
      let overlaps = false;
      for (let i = start; i < end; i++) {
        if (processedIndices.has(i)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        for (let i = start; i < end; i++) {
          processedIndices.add(i);
        }
        matches.push({
          index: start,
          length: codeMatch[0].length,
          endIndex: end,
          component: <code key={`code-${key++}`} className="bg-emerald-50 text-emerald-700 px-1 py-0.5 rounded text-xs">{codeMatch[1]}</code>,
        });
      }
    }

    // Finally, find italic matches (*text*) that don't overlap
    const italicRegex = /\*(.+?)\*/g;
    let italicMatch;
    while ((italicMatch = italicRegex.exec(text)) !== null) {
      const start = italicMatch.index;
      const end = start + italicMatch[0].length;
      // Check if this range overlaps with any processed indices
      let overlaps = false;
      for (let i = start; i < end; i++) {
        if (processedIndices.has(i)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        for (let i = start; i < end; i++) {
          processedIndices.add(i);
        }
        matches.push({
          index: start,
          length: italicMatch[0].length,
          endIndex: end,
          component: <em key={`italic-${key++}`} className="italic">{italicMatch[1]}</em>,
        });
      }
    }

    // Sort matches by index
    matches.sort((a, b) => a.index - b.index);

    // Build parts
    let lastIndex = 0;
    matches.forEach((match) => {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      // Add match component
      parts.push(match.component);
      lastIndex = match.endIndex;
    });

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    // If no matches, return text as-is
    if (parts.length === 0) {
      return [text];
    }

    return parts;
  };

  return (
    <div className="markdown-content">
      {parseMarkdown(content)}
    </div>
  );
}

