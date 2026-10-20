"use client";
import * as React from "react";
import { displayNumber, parseNumberInput } from "@/lib/erp/ux";
/** Preserve the edit buffer and cursor; regroup on blur, reset on an external value change. */
export function NumericInput({
  value,
  onChange,
  onFocus,
  onBlur,
  ...props
}: React.ComponentProps<"input">) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [previous, setPrevious] = React.useState(value);
  const [expected, setExpected] = React.useState(String(value ?? ""));
  if (previous !== value) {
    setPrevious(value);
    if (String(value ?? "") !== expected) setEditing(null);
  }
  const shown = editing ?? displayNumber(String(value ?? ""));
  const invalid = parseNumberInput(shown) === null;
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={shown}
      pattern={String.raw`-?(?:\d+|\d{1,3}(?:\.\d{3})+)?(?:,\d*)?`}
      title="Use dots for thousands and a comma for decimals, for example 1.250,50."
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      onFocus={(e) => {
        setEditing(shown);
        onFocus?.(e);
      }}
      onChange={(event) => {
        const raw = event.target.value,
          parsed = parseNumberInput(raw);
        setExpected(parsed ?? raw);
        const cleaned = raw
          .replace(/^(Rp|IDR)\s*/i, "")
          .replace(/[\s\u00a0]/g, "");
        setEditing(
          parsed !== null && cleaned !== raw ? displayNumber(parsed) : raw,
        );
        onChange?.({
          ...event,
          target: { ...event.target, value: parsed ?? raw },
          currentTarget: { ...event.currentTarget, value: parsed ?? raw },
        });
      }}
      onBlur={(e) => {
        if (!invalid) setEditing(null);
        onBlur?.(e);
      }}
    />
  );
}
