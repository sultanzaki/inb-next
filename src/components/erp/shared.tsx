"use client";
import { useRef, useState, type ReactNode, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/workspace/confirm-provider";
import { erpAction } from "./data";
import type { ERPAction, ModuleKey } from "@/lib/erp/schema";
import { useERP } from "./context";
export function ERPField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="erp-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function ERPModal({
  title,
  description,
  children,
  onClose,
  dirty = false,
  layout = "form",
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  dirty?: boolean;
  layout?: "form" | "record";
}) {
  const confirm = useConfirm();
  async function close() {
    if (document.querySelector('form.erp-form[aria-busy="true"]')) return;
    if (
      (dirty ||
        Boolean(document.querySelector('form.erp-form[data-dirty="true"]'))) &&
      !(await confirm({
        title: "Discard changes?",
        description: "Your unsaved changes will be lost.",
        confirmLabel: "Discard changes",
      }))
    )
      return;
    onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) void close();
      }}
    >
      <DialogContent
        className={
          "erp-dialog" + (layout === "record" ? " erp-record-dialog" : "")
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function ERPForm({
  action,
  payload,
  onDone,
  children,
  label = "Save",
  disabled = false,
}: {
  action: ERPAction;
  payload: unknown;
  onDone: (id?: string, entity?: string) => void;
  children: ReactNode;
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const [initial] = useState(() => JSON.stringify(payload));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await erpAction(action, payload);
      toast.success("Saved.", {
        id: "erp-result",
        position: "bottom-left",
        duration: 2000,
      });
      onDone(data.id, data.entity);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="erp-form"
      aria-busy={busy}
      data-dirty={initial !== JSON.stringify(payload)}
      onSubmit={submit}
    >
      <div className="erp-form-body">
        {error && (
          <p role="alert" className="erp-error">
            {error}
          </p>
        )}
        {children}
      </div>
      <DialogFooter>
        <Button type="submit" loading={busy} disabled={disabled}>
          {label}
        </Button>
      </DialogFooter>
    </form>
  );
}
export function ERPActionButton({
  action,
  payload,
  children,
  onDone,
  reason = false,
  destructive = false,
  disabled = false,
}: {
  action: ERPAction;
  payload: Record<string, unknown>;
  children: ReactNode;
  onDone: (id?: string, entity?: string) => void;
  reason?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [why, setWhy] = useState("");
  return (
    <>
      <Button
        size="sm"
        variant={destructive ? "destructive" : "outline"}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      {open && (
        <ERPModal
          title={typeof children === "string" ? children : "Confirm action"}
          description="This action is recorded in the audit log."
          onClose={() => setOpen(false)}
        >
          <ERPForm
            action={action}
            payload={{ ...payload, ...(reason ? { reason: why } : {}) }}
            onDone={(id, entity) => {
              setOpen(false);
              onDone(id, entity);
            }}
            label="Confirm"
          >
            {reason ? (
              <ERPField label="Reason">
                <Input
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                  required
                  maxLength={150}
                />
              </ERPField>
            ) : (
              <p>Continue with this action?</p>
            )}
          </ERPForm>
        </ERPModal>
      )}
    </>
  );
}
export function ERPModuleGuard({
  module,
  children,
}: {
  module: ModuleKey;
  children: ReactNode;
}) {
  const { data, error, can, refresh } = useERP();
  if (error)
    return (
      <div className="erp-empty" role="alert">
        <p>{error}</p>
        <Button variant="outline" onClick={refresh}>
          Retry configuration
        </Button>
      </div>
    );
  if (!data) return <p role="status">Preparing workspace…</p>;
  if (!can(module))
    return (
      <div className="erp-empty">
        <h2>Module unavailable</h2>
        <p>This module is disabled or your account does not have access.</p>
      </div>
    );
  return (
    <>
      {data.modules.find((m) => m.key === module)?.state === "read_only" && (
        <p className="erp-notice">
          Read-only mode. Existing records remain available.
        </p>
      )}
      {children}
    </>
  );
}
