"use client";
import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";
import { NumericInput } from "./numeric-input";

function Input({
  className,
  type,
  numberFormat = "localized",
  ...props
}: React.ComponentProps<"input"> & { numberFormat?: "localized" | "raw" }) {
  const Component =
    props.inputMode === "decimal" && numberFormat !== "raw"
      ? NumericInput
      : InputPrimitive;
  return (
    <Component
      type={type}
      data-slot="input"
      className={cn(
        "h-[42px] w-full min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-sm transition-colors duration-150 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
