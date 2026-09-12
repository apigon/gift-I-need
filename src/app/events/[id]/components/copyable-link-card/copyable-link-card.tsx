"use client";

import { useState } from "react";

import { Button, Text, notify } from "@/components";

// A toast supplements, never replaces, an inline confirmation (CLAUDE.md
// design-system rule) — the button's own label flips to "Copied!" alongside
// the toast. Deliberately does NOT revert back to "Copy link": a brief flip
// is easy to miss if you glance away, and there's no reason a copied link
// needs to look "uncopied" again — clicking it a second time just re-copies
// the same href.
export function CopyableLinkCard({
  label,
  description,
  href,
}: {
  label: string;
  description: string;
  href: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      notify.success("Link copied");
    } catch {
      notify.error("Couldn't copy the link", "Copy it manually instead.");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-edge bg-surface p-4">
      <div>
        <Text variant="small">{label}</Text>
        <Text variant="small" tone="muted">
          {description}
        </Text>
      </div>
      <div className="flex items-center gap-3">
        <Text as="span" variant="small" tone="muted" className="min-w-0 flex-1 truncate">
          {href}
        </Text>
        <Button
          type="button"
          variant="secondary"
          onClick={handleCopy}
          className="shrink-0"
        >
          {copied ? "Copied!" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
