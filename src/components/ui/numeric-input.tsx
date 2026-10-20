"use client";
import * as React from "react";
import { numericDisplay, numericEdit } from "@/lib/erp/numeric-edit";
import { parseNumberInput } from "@/lib/erp/ux";

/** Keep localized display and canonical form state separate, including during edits. */
export function NumericInput({
  value,
  defaultValue,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  ref,
  ...props
}: React.ComponentProps<"input">) {
  const input = React.useRef<HTMLInputElement | null>(null);
  const [buffer, setBuffer] = React.useState(() => ({
    source: String(value ?? defaultValue ?? ""),
    text: numericDisplay(String(value ?? defaultValue ?? "")),
  }));
  const [selection, setSelection] = React.useState<{
    start: number;
    end: number;
  } | null>(null);
  const source = String(value ?? buffer.source);
  const shown = source === buffer.source ? buffer.text : numericDisplay(source);
  const invalid = parseNumberInput(shown) === null || shown === "-";
  React.useLayoutEffect(() => {
    if (selection && document.activeElement === input.current) {
      input.current?.setSelectionRange(selection.start, selection.end);
    }
  }, [selection, shown]);
  function emit(
    event: React.ChangeEvent<HTMLInputElement>,
    raw: string,
    caret: number,
    nativeEdit: boolean,
  ) {
    const next = numericEdit(raw, caret, nativeEdit);
    setBuffer({ source: next.value, text: next.text });
    setSelection({ start: next.caret, end: next.caret });
    // Preserve native element properties (name, validity, form, selection, etc.).
    const target = new Proxy(event.currentTarget, {
      get(element, key) {
        if (key === "value") return next.value;
        const result = Reflect.get(element, key, element);
        return typeof result === "function" ? result.bind(element) : result;
      },
    });
    onChange?.({ ...event, target, currentTarget: target });
  }
  return (
    <input
      {...props}
      ref={(node) => {
        input.current = node;
        if (typeof ref === "function") return ref(node);
        if (ref) ref.current = node;
      }}
      type="text"
      inputMode="decimal"
      value={shown}
      pattern={String.raw`-?(?:\d+|\d{1,3}(?:\.\d{3})+)?(?:,\d*)?`}
      title="Use dots for thousands and a comma for decimals, for example 1.250,50."
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      onFocus={onFocus}
      onChange={(event) => {
        const native = event.nativeEvent as InputEvent;
        const type = native.inputType || "";
        const caret = event.target.selectionStart ?? event.target.value.length;
        const raw =
          native.data === "." && type === "insertText"
            ? event.target.value.slice(0, caret - 1) +
              "," +
              event.target.value.slice(caret)
            : event.target.value;
        emit(
          event,
          raw,
          caret,
          type.startsWith("delete") ||
            ((type === "insertText" || type === "insertCompositionText") &&
              native.data?.length === 1),
        );
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        const element = event.currentTarget,
          start = element.selectionStart ?? 0,
          end = element.selectionEnd ?? start;
        if (event.key === "." || event.key === "," || event.key === "Decimal") {
          event.preventDefault();
          const retained = shown.slice(0, start) + shown.slice(end);
          if (retained.includes(",")) {
            const decimal = shown.indexOf(",") + 1;
            element.setSelectionRange(decimal, decimal);
            return;
          }
          const next = shown.slice(0, start) + "," + shown.slice(end);
          emit(
            event as unknown as React.ChangeEvent<HTMLInputElement>,
            next,
            start + 1,
            true,
          );
        } else if (
          start === end &&
          event.key === "Backspace" &&
          shown[start - 1] === "."
        ) {
          element.setSelectionRange(Math.max(0, start - 2), start);
        } else if (
          start === end &&
          event.key === "Delete" &&
          shown[start] === "."
        ) {
          element.setSelectionRange(start, start + 2);
        }
      }}
      onBlur={(event) => {
        if (!invalid) setBuffer({ source, text: numericDisplay(source) });
        setSelection(null);
        onBlur?.(event);
      }}
    />
  );
}
