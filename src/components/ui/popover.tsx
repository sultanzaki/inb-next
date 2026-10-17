"use client";
import { Popover as Base } from "@base-ui/react/popover";
import type { ReactNode } from "react";
export const Popover = Base.Root;
export const PopoverTrigger = Base.Trigger;
export function PopoverContent({
  children,
  className = "",
  align = "start",
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={6} align={align} className="z-[80]">
        <Base.Popup aria-label="Choose an option" className={className}>
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}
