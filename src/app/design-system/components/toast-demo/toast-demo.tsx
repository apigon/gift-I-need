"use client";

import { Button, notify } from "@/components";

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="primary"
        onClick={() =>
          notify.success(
            "You claimed this gift",
            'Botanical garden annual pass is now marked "Taken" for other guests.',
          )
        }
      >
        Trigger success toast
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          notify.error(
            "Someone else just claimed this",
            "The list has been refreshed. Pick another idea.",
          )
        }
      >
        Trigger error toast
      </Button>
    </div>
  );
}
