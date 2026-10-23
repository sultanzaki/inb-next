"use client";
import { ContextSummary } from "@/components/workspace/record-overview";
import {
  useRef,
  useEffect,
  useState,
  useId,
  createContext,
  useContext,
  Children,
  isValidElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import { SaveStatus } from "@/components/workspace/save-status";
import { useOperatorState } from "@/components/workspace/form-recovery";
import {
  FormJourney,
  type JourneyHandle,
} from "@/components/workspace/form-journey";
import {
  FormRecovery,
  RecoveryNotice,
  useFormRecovery,
} from "@/components/workspace/form-recovery";
import { RecordLoadingBoundary } from "@/components/workspace/record-loading";
import { toast } from "sonner";
import { SlideConfirm } from "@/components/ui/slide-confirm";
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
import {
  fieldHelp,
  humanLabel,
  validationFields,
  type FieldError,
} from "@/lib/erp/ux";
import { actionSchemas } from "@/lib/erp/schema";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ERPRequestError, erpAction } from "./data";
import type { ERPAction, ModuleKey } from "@/lib/erp/schema";
import { useERP } from "./context";
const Validation = createContext<{ errors: FieldError[]; payload: unknown }>({
  errors: [],
  payload: {},
});
const aliases: Record<string, string> = {
  "company name": "name",
  "contact person": "contact",
  "tax identifier": "tax_id",
  "source order": "order_id",
  "source record": "source_id",
  counterparty: "party_id",
  "verified payment": "payment_id",
  "issued document": "document_id",
  "payment amount": "amount",
  "allocation amount": "amount",
  "amount to move": "amount",
  "credit amount": "amount",
  "bank / cash account reference": "bank_account",
  "bank transaction reference": "bank_reference",
  "verified funds / bank evidence reference": "evidence",
  "payment date": "date",
  "document date": "date",
  "document type": "kind",
  "payment mode": "mode",
  "deposit percentage": "deposit_percent",
  "when to issue the invoice": "billing_event",
  "invoice trigger": "billing_event",
  "posted delivery (unless billing at order)": "delivery_id",
  customer: "customer_id",
  product: "product_id",
  supplier: "supplier_id",
  unit: "unit_id",
  location: "location_id",
};
export function useERPFieldError(name: string | undefined, label: string) {
  const context = useContext(Validation);
  const path =
    name ||
    aliases[label.toLowerCase()] ||
    label.toLowerCase().replaceAll(" ", "_");
  return context.errors.find((e) => e.path === path);
}
export function HelpTip({
  text,
  label = "Field help",
}: {
  text: string;
  label?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button type="button" className="erp-help" aria-label={label} />
        }
      >
        ?
      </PopoverTrigger>
      <PopoverContent className="max-w-80 rounded-lg border bg-surface p-3 text-sm text-foreground shadow-lg leading-relaxed">
        {text}
      </PopoverContent>
    </Popover>
  );
}
export function ERPField({
  label,
  children,
  hint,
  name,
  help,
  controlId,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  name?: string;
  help?: string;
  controlId?: string;
}) {
  const generatedId = useId(),
    context = useContext(Validation);
  const id = controlId || generatedId;
  const guessed = label.toLowerCase().replaceAll(" ", "_");
  const path = name || aliases[label.toLowerCase()] || guessed;
  const error = context.errors.find((e) => e.path === path);
  const explanation =
    help || fieldHelp[path] || fieldHelp[path.split(".").at(-1) || ""];
  const items = Children.toArray(children);
  const controlIndex = items.findIndex(
    (child) =>
      isValidElement(child) &&
      (typeof child.type !== "string" ||
        ["input", "textarea", "select"].includes(child.type)),
  );
  const content = items.map((child, index) => {
    if (index === controlIndex && isValidElement(child)) {
      const el = child as ReactElement<Record<string, unknown>>;
      return cloneElement(el, {
        id: el.props.id || id,
        name: el.props.name || path,
        "aria-invalid": error ? true : el.props["aria-invalid"],
        "aria-describedby":
          [
            el.props["aria-describedby"],
            hint ? id + "-hint" : "",
            error ? id + "-error" : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
      });
    }
    return child;
  });
  return (
    <div className="erp-field" data-field-path={path}>
      <div className="flex items-center gap-2">
        <label htmlFor={id}>{label}</label>
        {explanation && <HelpTip text={explanation} label={"About " + label} />}
      </div>
      {content}
      {hint && <small id={id + "-hint"}>{hint}</small>}
      {error && (
        <small id={id + "-error"} className="text-destructive" role="alert">
          {error.message}
        </small>
      )}
    </div>
  );
}
export function ERPModal(props: Parameters<typeof ERPModalContent>[0]) {
  return (
    <FormRecovery scope={props.title}>
      <ERPModalContent {...props} />
    </FormRecovery>
  );
}
function ERPModalContent({
  title,
  description,
  children,
  onClose,
  dirty = false,
  layout = "form",
  loading = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  dirty?: boolean;
  layout?: "form" | "record";
  loading?: boolean;
}) {
  const confirm = useConfirm();
  const recovery = useFormRecovery();
  const [open, setOpen] = useState(true);
  const popup = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (
        dirty ||
        popup.current?.querySelector(
          'form[data-dirty="true"], form[aria-busy="true"]',
        )
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  async function close() {
    if (
      closing.current ||
      popup.current?.querySelector('form[aria-busy="true"]')
    )
      return;
    closing.current = true;
    try {
      if (
        (dirty ||
          Boolean(popup.current?.querySelector('form[data-dirty="true"]'))) &&
        !(await confirm({
          title: "Discard changes?",
          description: "Your unsaved changes will be lost.",
          confirmLabel: "Discard changes",
        }))
      )
        return;
      if (dirty || popup.current?.querySelector('form[data-dirty="true"]'))
        recovery?.clear();
      setOpen(false);
    } finally {
      closing.current = false;
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next) {
          details.cancel();
          void close();
        }
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        ref={popup}
        className={
          "erp-dialog" + (layout === "record" ? " erp-record-dialog" : "")
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {layout === "record" ? (
          <RecordLoadingBoundary loading={loading}>
            {children}
          </RecordLoadingBoundary>
        ) : (
          children
        )}
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
  destructive = false,
}: {
  action: ERPAction;
  payload: unknown;
  onDone: (id?: string, entity?: string) => void;
  children: ReactNode;
  label?: string;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [fields, setFields] = useState<FieldError[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  function focusField(path?: string) {
    requestAnimationFrame(() => {
      const wrappers =
        formRef.current?.querySelectorAll<HTMLElement>("[data-field-path]");
      const wrapper =
        Array.from(wrappers || []).find(
          (el) => el.dataset.fieldPath === path,
        ) ||
        Array.from(wrappers || []).find(
          (el) => path && el.dataset.fieldPath?.startsWith(path + "."),
        );
      const target =
        wrapper?.querySelector<HTMLElement>("input,select,textarea") ||
        wrapper?.querySelector<HTMLElement>(".erp-picker-trigger") ||
        wrapper?.querySelector<HTMLElement>("button") ||
        formRef.current?.querySelector<HTMLElement>("[role=alert]");
      target?.focus();
      target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
  const recovery = useFormRecovery();
  const journey = useRef<JourneyHandle>(null);
  const [uncertain, setUncertain] = useOperatorState(
    "save-uncertain:" + action,
    false,
  );
  const pending = useRef(false);
  const slidePermit = useRef(false);
  const requiresSlide =
    /^(Confirm|Approve|Post|Issue|Release|Publish|Verify)\b/i.test(label);
  const [initial] = useState(() => JSON.stringify(payload));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending.current || uncertain) return;
    if (!journey.current?.beforeSubmit()) return;
    if (requiresSlide && !slidePermit.current) return;
    slidePermit.current = false;
    const parsed = actionSchemas[action].safeParse(payload);
    const nativeErrors: FieldError[] = [];
    for (const el of Array.from(
      formRef.current?.querySelectorAll<HTMLInputElement>(
        "input,select,textarea",
      ) || [],
    )) {
      if (!el.validity.valid)
        nativeErrors.push({
          path: el.name,
          message: el.validity.valueMissing
            ? "Complete this field."
            : el.validity.patternMismatch && el.title
              ? el.title
              : el.validationMessage,
        });
    }
    const issues = Array.from(
      new Map(
        [
          ...(!parsed.success ? validationFields(parsed.error.issues) : []),
          ...nativeErrors,
        ].map((issue) => [issue.path, issue]),
      ).values(),
    );
    if (issues.length) {
      journey.current?.reveal();
      setFields(issues);
      setError("Review the fields below before saving.");
      focusField(issues[0].path);
      return;
    }
    setFields([]);
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await erpAction(action, payload);
      toast.success(
        (
          {
            fin_verify_payment: "Payment verified.",
            fin_allocate: "Payment allocated.",
            fin_issue_document: "Document issued.",
            fin_create_document: "Billing draft saved.",
            post_move: "Stock movement posted.",
            receive_purchase: "Receipt posted.",
            save_draft: "Draft saved.",
          } as Record<string, string>
        )[action] || "Changes saved.",
        {
          id: "erp-result",
          position: "bottom-left",
          duration: 2000,
        },
      );
      recovery?.clear();
      onDone(data.id, data.entity);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
      journey.current?.reveal();
      if (e instanceof ERPRequestError) {
        setFields(e.fields);
        setUncertain(e.uncertain);
      }
      focusField(e instanceof ERPRequestError ? e.fields[0]?.path : undefined);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Validation value={{ errors: fields, payload }}>
      <form
        ref={formRef}
        noValidate
        className="erp-form"
        aria-busy={busy}
        data-dirty={
          initial !== JSON.stringify(payload) ||
          Boolean(Object.keys(recovery?.restored || {}).length)
        }
        onSubmit={submit}
        onChange={(event) => {
          const target = event.target;
          if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement
          ) {
            if (fields.some((f) => f.path === target.name)) {
              const remaining = fields.filter((f) => f.path !== target.name);
              setFields(remaining);
              if (!remaining.length) setError("");
            }
          }
        }}
      >
        <div className="erp-form-body contextual-form-body">
          <ContextSummary values={payload} />
          <div className="context-form-main">
            <RecoveryNotice />
            <SaveStatus
              uncertain={uncertain}
              onChecked={() => setUncertain(false)}
            />
            {busy && (
              <p role="status" className="save-status">
                Saving changes… Keep this form open.
              </p>
            )}
            {error && (
              <div role="alert" tabIndex={-1} className="erp-error">
                <p>{error}</p>
                {fields.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {fields.map((f, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          className="text-left underline"
                          onClick={() => focusField(f.path)}
                        >
                          {humanLabel(
                            f.path.replace(
                              /\.(\d+)\./g,
                              (_, n) => ` · line ${Number(n) + 1} · `,
                            ),
                          )}
                          : {f.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <FormJourney
              ref={journey}
              sections={(() => {
                const items = Children.toArray(children);
                if (
                  items.length === 1 &&
                  isValidElement<{ className?: string; children?: ReactNode }>(
                    items[0],
                  ) &&
                  items[0].props.className?.includes("erp-form-grid")
                ) {
                  const fields = Children.toArray(items[0].props.children);
                  if (fields.length > 6)
                    return [
                      {
                        title: "Primary details",
                        content: (
                          <div className="erp-form-grid">
                            {fields.slice(0, 4)}
                          </div>
                        ),
                      },
                      {
                        title: "Additional information",
                        content: (
                          <div className="erp-form-grid">{fields.slice(4)}</div>
                        ),
                      },
                    ];
                }

                const line = items.findIndex(
                  (item) =>
                    isValidElement<{ className?: string }>(item) &&
                    item.props.className?.includes("erp-line-editor"),
                );
                const cut = line > 0 ? line : Math.ceil(items.length / 2);
                return items.length >= 5
                  ? [
                      { title: "Details", content: items.slice(0, cut) },
                      {
                        title:
                          line >= 0
                            ? "Items and terms"
                            : "Additional information",
                        content: items.slice(cut),
                      },
                    ]
                  : [{ title: "Details", content: children }];
              })()}
            />
          </div>
        </div>
        <DialogFooter>
          {requiresSlide ? (
            <SlideConfirm
              label={label}
              busy={busy}
              disabled={disabled || uncertain}
              destructive={destructive}
              resetKey={JSON.stringify(payload)}
              onConfirm={() => {
                slidePermit.current = true;
                formRef.current?.requestSubmit();
              }}
            />
          ) : (
            <Button
              type="submit"
              loading={busy}
              disabled={disabled || busy || uncertain}
            >
              {label}
            </Button>
          )}
        </DialogFooter>
      </form>
    </Validation>
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
          description=""
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
            destructive={destructive}
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
