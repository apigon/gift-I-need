import NextLink from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export function Link({
  className,
  ...props
}: ComponentProps<typeof NextLink>) {
  return (
    <NextLink
      className={cn(
        "text-accent underline underline-offset-2 hover:decoration-2",
        className,
      )}
      {...props}
    />
  );
}
