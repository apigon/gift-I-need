"use client";

import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";

export type ComboboxOption = { value: string; label: string };

// A single-select, type-to-filter dropdown for a long option list (the
// timezone override picker's ~400 IANA zone names). Hand-rolled, per the
// "no new UI-library dependency" decision every other primitive already
// follows — no prior art in this codebase for the ARIA combobox pattern, so
// the accessibility wiring below is deliberate:
//   - the filter <input> carries role="combobox", aria-expanded and
//     aria-controls pointing at the popup's id
//   - the popup carries role="listbox"; each row role="option" with a
//     stable id referenced by aria-activedescendant as the highlighted
//     index changes
//   - Arrow Up/Down move the highlighted option, Enter commits it, Escape
//     closes without changing the committed value, and a click outside
//     closes it the same way
//   - the committed value is mirrored into a hidden <input> so a
//     surrounding <form> submits the selected value, not the filter text
export function Combobox({
  id,
  label,
  name,
  options,
  value,
  onChange,
  error,
  hint,
  placeholder,
}: {
  id: string;
  label: string;
  name: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
}) {
  const listboxId = `${id}-listbox`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const selectedOption = options.find((option) => option.value === value);

  // `query` is only the user's in-progress edit buffer while the popup is
  // open. While closed, the displayed text is DERIVED from `value` on every
  // render (see the input's `value` prop below) rather than synced via an
  // effect — so an externally-changed `value` (e.g. a parent resetting the
  // form) is reflected immediately with no cascading-render risk.
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Until the user actually types something different from the committed
  // label, show the full list — filtering on the committed label the
  // instant the popup opens would show only (near-)exact matches.
  const filteredOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed || trimmed === selectedOption?.label.toLowerCase()) {
      return options;
    }
    return options.filter((option) =>
      option.label.toLowerCase().includes(trimmed),
    );
  }, [query, options, selectedOption]);

  useEffect(() => {
    if (!open) return;

    // `pointerdown`, not `mousedown` — unifies mouse, touch and pen so a tap
    // outside the popup on a touch device closes it the same way a click
    // does on desktop.
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Opens the popup with the full option list, seeding the edit buffer from
  // the currently committed value. Selects the input's text so the next
  // keystroke replaces it outright — without this, starting a fresh search
  // means first erasing the previously committed value by hand.
  function openPopup() {
    setQuery(selectedOption?.label ?? "");
    setOpen(true);
    setHighlightedIndex(0);
    inputRef.current?.select();
  }

  function commit(option: ComboboxOption) {
    onChange(option.value);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openPopup();
        return;
      }
      setHighlightedIndex((index) =>
        Math.min(index + 1, filteredOptions.length - 1),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (open && filteredOptions[highlightedIndex]) {
        event.preventDefault();
        commit(filteredOptions[highlightedIndex]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  }

  const activeOptionId =
    open && filteredOptions[highlightedIndex]
      ? `${listboxId}-option-${highlightedIndex}`
      : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className={cn("text-small", error ? "text-danger" : "text-fg")}
      >
        {label}
      </label>
      {/* Its own positioned wrapper (not the outer label/hint/error stack) so
          the popup sits flush under the INPUT specifically, regardless of
          whether a hint/error line is also rendered below. */}
      <div ref={containerRef} className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          placeholder={placeholder}
          value={open ? query : (selectedOption?.label ?? "")}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={openPopup}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full rounded-control border bg-surface px-2 py-1 pr-8 text-body text-fg",
            error ? "border-danger" : "border-edge",
          )}
        />
        {/* Decorative dropdown affordance — distinguishes this from a plain
            text input at a glance. Not interactive, so it carries no role. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className={cn(
            "pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted transition-transform",
            open ? "rotate-180" : undefined,
          )}
        >
          <path
            d="M5 7.5 10 12.5 15 7.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {/* Mirrors the committed value so a surrounding <form> submits the
            selected option's value, not whatever filter text is currently
            typed into the visible input above. */}
        <input type="hidden" name={name} value={value} />
        {open ? (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute top-full z-10 max-h-60 w-full overflow-auto rounded-control border border-edge bg-surface py-1 shadow-lg"
          >
            {filteredOptions.length === 0 ? (
              <li className="px-2 py-1 text-small text-fg-muted">
                No matches
              </li>
            ) : (
              filteredOptions.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  // Prevents the input from blurring before the click
                  // handler fires — otherwise the popup would close (via
                  // blur) before the click/tap ever registers. `onPointerDown`
                  // (not `onMouseDown`) so this also holds on touch devices.
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => commit(option)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={cn(
                    "cursor-pointer px-2 py-1 text-body",
                    index === highlightedIndex ? "bg-surface-tint" : undefined,
                  )}
                >
                  {option.label}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      {hint ? (
        <span id={hintId} className="text-small text-fg-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-small text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
