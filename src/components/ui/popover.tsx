"use client";
import { Popover as Base } from "@base-ui/react/popover";
import type { ReactNode } from "react";
import { cn } from "cn";
export const Popover = Base.Root;
export const PopoverTrigger = Base.Trigger;
export function PopoverContent({
  children,
  className = "",
  align = "start",
  label = "Choose an option",
  collisionPadding,
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  label?: string;
  collisionPadding?: number;
}) {
  return (
    <Base.Portal>
      <Base.Positioner
        sideOffset={6}
        align={align}
        collisionPadding={collisionPadding}
        className="z-[80]"
      >
        <Base.Popup
          data-slot="popover-content"
          aria-label={label}
          className={cn(
            "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none",
            className,
          )}
        >
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}
