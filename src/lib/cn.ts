// Class-join helper. No conflict resolution — className on a primitive is
// layout-only (margin, width, flex placement), so nothing here ever needs to
// override a variant's own color/typography classes. If a slice later needs
// conflict resolution, re-export `clsx` (or `clsx` + `tailwind-merge`) here;
// call sites don't change.
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
