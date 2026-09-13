"use client";

import { Button } from "@/components";

export function ClaimButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" onClick={onClick}>
      Claim
    </Button>
  );
}
