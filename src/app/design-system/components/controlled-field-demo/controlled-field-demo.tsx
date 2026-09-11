"use client";

import { useState } from "react";

import { Input } from "@/components";

export function ControlledFieldDemo() {
  const [value, setValue] = useState("");

  return (
    <Input
      id="ds-controlled"
      label="Controlled (value/onChange)"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
