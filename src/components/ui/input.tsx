"use client";
import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";
import { NumericInput } from "./numeric-input";

const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

function Input({
  className,
  type,
  numberFormat = "localized",
  prefix,
  suffix,
  ...props
}: React.ComponentProps<"input"> & {
  numberFormat?: "localized" | "raw";
  prefix?: string;
  suffix?: string;
}) {
  const affixId = React.useId();
  // Keep fast typing from being discarded before controlled handlers attach.
  const hydrated = React.useSyncExternalStore(
    subscribeHydration,
    clientHydrated,
    serverHydrated,
  );
  const decorated = Boolean(prefix || suffix);
  const Component =
    (props.inputMode === "decimal" || type === "number") &&
    numberFormat !== "raw"
      ? NumericInput
      : InputPrimitive;
  const input = (
    <Component
      type={type}
      data-slot="input"
      className={cn(
        "h-[42px] w-full min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-sm transition-colors duration-150 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        decorated && "input-affix-control",
        className,
      )}
      {...props}
      readOnly={props.readOnly || !hydrated}
      aria-describedby={
        [props["aria-describedby"], decorated ? affixId : undefined]
          .filter(Boolean)
          .join(" ") || undefined
      }
    />
  );
  if (!decorated) return input;
  return (
    <span className="input-affix" data-disabled={props.disabled || undefined}>
      {prefix && (
        <span className="input-affix-label" aria-hidden="true">
          {prefix}
        </span>
      )}
      {input}
      {suffix && (
        <span className="input-affix-label" aria-hidden="true">
          {suffix}
        </span>
      )}
      <span id={affixId} className="sr-only">
        {[prefix, suffix].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

export { Input };
