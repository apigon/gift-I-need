"use client";

import { useState } from "react";

import { Combobox } from "@/components";

const FRUIT_OPTIONS = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
  { value: "durian", label: "Durian" },
  { value: "elderberry", label: "Elderberry" },
  { value: "fig", label: "Fig" },
  { value: "grape", label: "Grape" },
];

export function ComboboxDemo() {
  const [value, setValue] = useState("banana");

  return (
    <Combobox
      id="ds-combobox"
      label="Favourite fruit"
      name="fruit"
      options={FRUIT_OPTIONS}
      value={value}
      onChange={setValue}
      hint="Type to filter, arrow keys to move, Enter to pick, Escape to cancel."
    />
  );
}
