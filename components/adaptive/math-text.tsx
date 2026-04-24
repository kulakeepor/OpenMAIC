'use client';

/**
 * MathText — renders plain text with inline LaTeX math.
 *
 * Supports:
 *   - Inline math: $...$ or \(...\)
 *   - Display math: $$...$$ or \[...\]
 *
 * Falls back to plain text if KaTeX fails.
 */

import 'katex/dist/katex.min.css';
import katex from 'katex';

interface MathTextProps {
  children: string;
  className?: string;
}

function renderSegments(text: string): React.ReactNode[] {
  // Match $$...$$ first (display), then $...$ (inline), then \[...\] and \(...\)
  const pattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+?\$|\\\([^)]+?\\\))/g;

  const segments: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      segments.push(
        <span key={key++}>{text.slice(lastIndex, match.index)}</span>
      );
    }

    const raw = match[0];
    const isDisplay = raw.startsWith('$$') || raw.startsWith('\\[');
    const inner = raw
      .replace(/^\$\$/, '').replace(/\$\$$/, '')
      .replace(/^\\\[/, '').replace(/\\\]$/, '')
      .replace(/^\$/, '').replace(/\$$/, '')
      .replace(/^\\\(/, '').replace(/\\\)$/, '');

    try {
      const html = katex.renderToString(inner, {
        displayMode: isDisplay,
        throwOnError: false,
        strict: false,
      });
      segments.push(
        <span
          key={key++}
          dangerouslySetInnerHTML={{ __html: html }}
          className={isDisplay ? 'block my-1' : 'inline'}
        />
      );
    } catch {
      segments.push(<span key={key++}>{raw}</span>);
    }

    lastIndex = match.index + raw.length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    segments.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }

  return segments;
}

export function MathText({ children, className }: MathTextProps) {
  if (!children) return null;

  // Handle newlines — split on \n, render each line
  const lines = children.split('\n');

  return (
    <span className={className}>
      {lines.map((line, i) => (
        <span key={i}>
          {renderSegments(line)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </span>
  );
}
