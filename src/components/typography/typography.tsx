import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/cn";

type HeadingSize = "display" | "title" | "heading";

const HEADING_SIZE_CLASS: Record<HeadingSize, string> = {
  display: "text-display",
  title: "text-title",
  heading: "text-heading",
};

const DEFAULT_SIZE_BY_LEVEL: Record<1 | 2 | 3, HeadingSize> = {
  1: "title",
  2: "heading",
  3: "heading",
};

export function Heading({
  level,
  size,
  className,
  children,
}: {
  level: 1 | 2 | 3;
  size?: HeadingSize;
  className?: string;
  children: ReactNode;
}) {
  const Tag = `h${level}` as const;
  const resolvedSize = size ?? DEFAULT_SIZE_BY_LEVEL[level];

  return (
    <Tag
      className={cn(
        "font-display",
        HEADING_SIZE_CLASS[resolvedSize],
        className,
      )}
    >
      {children}
    </Tag>
  );
}

type TextVariant = "body" | "small" | "caption";
type TextTone = "default" | "muted";

const TEXT_VARIANT_CLASS: Record<TextVariant, string> = {
  body: "text-body",
  small: "text-small",
  caption: "text-caption uppercase tracking-wide",
};

const TEXT_TONE_CLASS: Record<TextTone, string> = {
  default: "text-fg",
  muted: "text-fg-muted",
};

export function Text({
  as: Tag = "p",
  variant = "body",
  tone = "default",
  className,
  children,
}: {
  as?: ElementType<{ className?: string; children?: ReactNode }>;
  variant?: TextVariant;
  tone?: TextTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        TEXT_VARIANT_CLASS[variant],
        TEXT_TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
