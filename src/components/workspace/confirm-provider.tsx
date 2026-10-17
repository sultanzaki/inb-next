"use client";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Options = {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
};
type Confirm = (options: Options) => Promise<boolean>;
const Context = createContext<Confirm | null>(null);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<Options | null>(null);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const confirm: Confirm = (next) =>
    new Promise<boolean>((done) => {
      resolve.current?.(false);
      resolve.current = done;
      setOptions(next);
    });
  function finish(value: boolean) {
    resolve.current?.(value);
    resolve.current = null;
    setOptions(null);
  }
  return (
    <Context value={confirm}>
      {children}
      <Dialog
        open={options !== null}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <span className="confirm-icon mb-4">
              <AlertTriangle className="size-6" />
            </span>
            <DialogTitle>{options?.title}</DialogTitle>
            <DialogDescription className="mt-2 leading-relaxed">
              {options?.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button variant="outline" autoFocus onClick={() => finish(false)}>
              Back
            </Button>
            <Button
              variant={
                options?.destructive === false ? "default" : "destructive"
              }
              onClick={() => finish(true)}
            >
              {options?.confirmLabel ?? "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Context>
  );
}
export function useConfirm() {
  const confirm = useContext(Context);
  if (!confirm) throw new Error("useConfirm requires ConfirmProvider");
  return confirm;
}
