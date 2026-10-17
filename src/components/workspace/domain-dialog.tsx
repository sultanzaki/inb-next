"use client";
import { useEffect, useRef, type ComponentProps } from "react";
import { Dialog } from "@/components/ui/dialog";
import { useConfirm } from "./confirm-provider";

type Props = ComponentProps<typeof Dialog> & {
  open: boolean;
  dirtyValue: unknown;
  busy?: boolean;
};
export function DomainDialog({
  open,
  dirtyValue,
  busy = false,
  onOpenChange,
  ...props
}: Props) {
  const confirm = useConfirm();
  const baseline = useRef("");
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) baseline.current = JSON.stringify(dirtyValue);
    wasOpen.current = open;
  }, [open, dirtyValue]);
  useEffect(() => {
    if (!open) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (busy || baseline.current !== JSON.stringify(dirtyValue)) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [open, dirtyValue, busy]);
  return (
    <Dialog
      {...props}
      open={open}
      onOpenChange={async (next, details) => {
        if (!next && busy) {
          details.cancel();
          return;
        }
        if (!next && baseline.current !== JSON.stringify(dirtyValue)) {
          details.cancel();
          const discard = await confirm({
            title: "Discard your changes?",
            description: "You have unsaved changes.",
            confirmLabel: "Discard changes",
          });
          if (!discard) return;
        }
        onOpenChange?.(next, details);
      }}
    />
  );
}
