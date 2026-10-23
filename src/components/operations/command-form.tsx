"use client";
import { useRef, useState, useId, type FormEvent } from "react";
import { Plus, Trash2, ArrowRight, Info } from "lucide-react";
import { toast } from "sonner";
import {
  workCommands,
  type WorkField,
  type WorkRow,
} from "@/lib/operations/catalog";
import { clearDependentReferences } from "@/lib/operations/form-state";
import { commandSchema } from "@/lib/operations/validation";
import { businessDate } from "@/lib/domain/validation";
import { validationFields, humanLabel, displayNumber } from "@/lib/erp/ux";
import { requestTimeout } from "@/lib/request-timeout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SlideConfirm } from "@/components/ui/slide-confirm";
import { ERPModal } from "@/components/erp/shared";
import { useConfirm } from "@/components/workspace/confirm-provider";
import { ReferencePicker } from "./reference-picker";
function initial(field: WorkField, row?: WorkRow): unknown {
  if (row?.[field.key] != null) {
    if (field.kind === "lines") return row[field.key];
    return field.kind === "boolean"
      ? Boolean(row[field.key])
      : String(row[field.key]);
  }
  if (field.kind === "lines")
    return field.required
      ? [
          Object.fromEntries(
            (field.fields || []).map((f) => [f.key, initial(f)]),
          ),
        ]
      : [];
  if (field.kind === "date" && field.required) return businessDate();
  if (field.kind === "boolean") return field.default ?? false;
  return field.default ?? "";
}
export function CommandForm({
  action,
  row,
  onClose,
  onDone,
}: {
  action: string;
  row?: WorkRow;
  onClose: () => void;
  onDone: (result: { id: string; entity: string }) => void;
}) {
  const command = workCommands[action];
  const [unitLabels, setUnitLabels] = useState<Record<string, string>>({});
  const formId = useId();
  const confirm = useConfirm();
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const value = Object.fromEntries(
      command.fields.map((f) => [f.key, initial(f, row)]),
    );
    if (row && action === "set_warehouse_access") {
      value.user_id = row.id;
      value.warehouses = ((row.warehouses as WorkRow[]) || []).map((w) => ({
        warehouse_id: w.warehouse_id,
        read: w.can_read,
        write: w.can_write,
        approve: w.can_approve,
      }));
    }
    if (row && command.fields.some((f) => f.kind === "results")) {
      const results = (row.results as { name: string; value: string }[]) || [];
      value.results = (
        (row.spec_snapshot as { parameters?: { name: string }[] })
          ?.parameters || []
      ).map((p) => ({
        name: p.name,
        value: results.find((x) => x.name === p.name)?.value || "",
      }));
    }
    if (row && action === "receive_warehouse_transfer")
      value.lines = ((row.lines as WorkRow[]) || [])
        .filter((l) => Number(l.outstanding) > 0)
        .map((l) => ({
          line_id: l.id,
          quantity: String(l.outstanding),
          lost_quantity: "0",
        }));
    if (row && action === "reserve_manufacturing_material") {
      const requirements =
        (row.formula_snapshot as { requirements?: WorkRow[] })?.requirements ||
        [];
      if (requirements.length === 1) {
        value.material_id = requirements[0].material_id;
        value.quantity = requirements[0].required_quantity;
      }
    }
    return {
      ...value,
      ...(action === "repack_pallet" ? { location_id: row?.location_id } : {}),
      id: row?.id,
      version: row?.version,
    };
  });
  const [baseline] = useState(() => JSON.stringify(values));
  const request = useRef(crypto.randomUUID()),
    locked = useRef(false),
    confirmed = useRef(false),
    form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<{ path: string; message: string }[]>([]),
    [failure, setFailure] = useState("");
  const dirty = JSON.stringify(values) !== baseline;
  const context: WorkRow = {
    id: row?.id || "",
    ...row,
    requirements: (
      (row?.formula_snapshot as { requirements?: WorkRow[] })?.requirements ||
      []
    ).map((r) => ({
      ...r,
      id: String(r.material_id),
      label: `${r.material} · ${displayNumber(String(r.required_quantity))} ${r.unit}`,
    })),
  };
  function update(key: string, value: unknown, selected?: WorkRow) {
    setValues((current) => {
      const next = {
        ...clearDependentReferences(command.fields, current, key),
        [key]: value,
      };
      if (selected && key === "destination_pallet")
        next.destination_version = Number(selected.version);
      if (selected && key === "product_id" && selected.unit_id)
        next.unit_id = selected.unit_id;
      if (selected && key === "lot_id" && selected.location_id)
        next.location_id = selected.location_id;
      if (selected && key === "delivery_id") {
        next.version = Number(selected.version);
        next.pallet_id = row?.id;
        next.pallet_version = Number(row?.version);
      }
      if (key === "customer_id") {
        next.opportunity_id = "";
        next.sample_id = "";
      }
      if (key === "kind") next.lot_id = "";
      request.current = crypto.randomUUID();
      return next;
    });
    setErrors((current) => current.filter((e) => !e.path.startsWith(key)));
    setFailure("");
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (locked.current) return;
    if (command.confirm && !confirmed.current) return;
    confirmed.current = false;
    const parsed = commandSchema(action).safeParse({
      ...values,
      request_key: request.current,
    });
    if (!parsed.success) {
      setErrors(validationFields(parsed.error.issues));
      setFailure("Review the highlighted fields before continuing.");
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setFailure("");
    const controller = new AbortController(),
      timeout = requestTimeout(controller.signal, 60_000);
    try {
      const response = await fetch("/api/operations/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: timeout.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        setErrors(data.fields || []);
        throw Error(data.message || "Could not save changes. Retry.");
      }
      toast.success(
        "Saved. " +
          (command.confirm ? "The operation is recorded in history." : ""),
      );
      onDone(data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not reach the server. Retry.";
      setFailure(message);
      toast.error(message);
    } finally {
      timeout.dispose();
      locked.current = false;
      setBusy(false);
    }
  }
  function renderField(
    field: WorkField,
    path: string,
    current: Record<string, unknown>,
    set: (key: string, v: unknown, selected?: WorkRow) => void,
  ) {
    const id = formId + "-" + path,
      error = errors.find(
        (e) => e.path === path || e.path.startsWith(path + "."),
      );
    const isReadonly = Boolean(
      row &&
      action.startsWith("save_") &&
      [
        "material_id",
        "supplier_id",
        "product_id",
        "unit_id",
        "warehouse_id",
        "kind",
        "language",
        "deviation_id",
      ].includes(field.key),
    );
    const val = current[field.key];
    const unit =
      [
        "unit_id",
        "line_id",
        "reservation_id",
        "input_id",
        "content_id",
        "lot_id",
        "material_id",
        "product_id",
        "formula_id",
      ]
        .map((key) => unitLabels[String(current[key] || "")])
        .find(Boolean) ||
      ([
        "record_manufacturing_output",
        "complete_manufacturing_order",
        "create_sample_quotation",
        "dispose_material_quality",
      ].includes(action)
        ? String(row?.unit || "")
        : "");
    const suffix =
      field.kind === "number"
        ? /percent|tax_rate/.test(field.key)
          ? "%"
          : /quantity/.test(field.key)
            ? unit || "Select unit"
            : undefined
        : undefined;
    const prefix =
      field.kind === "number" && /^(price|amount|freight)$/.test(field.key)
        ? String(current.currency || values.currency || row?.currency || "IDR")
        : undefined;

    if (field.kind === "lines") {
      const rows = (val as Record<string, unknown>[]) || [];
      return (
        <section className="work-lines" key={path}>
          <div className="work-section-heading">
            <div>
              <h3>{field.label}</h3>
              <p>Review each item and its quantity before saving.</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || rows.length >= 100}
              onClick={() =>
                set(field.key, [
                  ...rows,
                  Object.fromEntries(
                    (field.fields || []).map((f) => [f.key, initial(f)]),
                  ),
                ])
              }
            >
              <Plus className="size-3.5" />
              Add line
            </Button>
          </div>
          {rows.map((line, index) => (
            <div key={index} className="work-line-card">
              <div className="work-line-number">
                <span>Line {index + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={"Remove line " + (index + 1)}
                  disabled={busy}
                  onClick={() =>
                    set(
                      field.key,
                      rows.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <div className="work-field-grid">
                {field.fields?.map((child) =>
                  renderField(
                    child,
                    `${path}.${index}.${child.key}`,
                    line,
                    (key, value, selected) => {
                      const next = {
                        ...clearDependentReferences(
                          field.fields || [],
                          line,
                          key,
                        ),
                        [key]: value,
                      };
                      if (key === "kind") next.lot_id = "";
                      if (selected && key === "lot_id" && selected.location_id)
                        next.location_id = selected.location_id;
                      set(
                        field.key,
                        rows.map((r, i) => (i === index ? next : r)),
                      );
                    },
                  ),
                )}
              </div>
            </div>
          ))}
          {!rows.length && <p className="work-quiet">No lines added.</p>}
          {error && (
            <p className="work-field-error" role="alert">
              {error.message}
            </p>
          )}
        </section>
      );
    }
    if (field.kind === "results")
      return (
        <section className="work-lines" key={path}>
          <h3>{field.label}</h3>
          {((val as { name: string; value: string }[]) || []).map(
            (result, index) => {
              const parameter = ((
                row?.spec_snapshot as { parameters?: WorkRow[] }
              )?.parameters || [])[index];
              const resultError = errors.find(
                (e) => e.path === `${path}.${index}.value`,
              );
              return (
                <label className="work-result" key={result.name}>
                  <span>
                    <strong>{result.name}</strong>
                    <small>
                      {parameter?.kind === "text"
                        ? "Expected: " + parameter.expected
                        : `${parameter?.minimum ?? "No minimum"} – ${parameter?.maximum ?? "No maximum"} ${parameter?.unit || ""}`}
                    </small>
                  </span>
                  <Input
                    disabled={busy}
                    numberFormat="raw"
                    suffix={String(parameter?.unit || "")}
                    value={result.value}
                    aria-label={result.name + " result"}
                    aria-invalid={Boolean(resultError) || undefined}
                    aria-describedby={
                      resultError ? `${id}-${index}-error` : undefined
                    }
                    onChange={(e) =>
                      set(
                        field.key,
                        (val as { name: string; value: string }[]).map(
                          (r, i) =>
                            i === index ? { ...r, value: e.target.value } : r,
                        ),
                      )
                    }
                  />
                  {resultError && (
                    <small
                      id={`${id}-${index}-error`}
                      className="work-field-error"
                      role="alert"
                    >
                      {resultError.message}
                    </small>
                  )}
                </label>
              );
            },
          )}
        </section>
      );
    return (
      <div
        className={
          "erp-field work-field" + (field.kind === "textarea" ? " is-wide" : "")
        }
        key={path}
        data-field-path={path}
      >
        <label htmlFor={id}>
          {field.label}
          {!field.required && field.kind !== "boolean" && (
            <small>Optional</small>
          )}
        </label>
        {field.kind === "ref" ? (
          <ReferencePicker
            id={id}
            field={field}
            value={String(val || "")}
            parent={context}
            values={{ ...row, ...values, ...current }}
            disabled={busy || isReadonly}
            invalid={Boolean(error)}
            onResolve={(value, unit) =>
              setUnitLabels((previous) =>
                previous[value] === unit
                  ? previous
                  : { ...previous, [value]: unit },
              )
            }
            onChange={(value, selected) => set(field.key, value, selected)}
          />
        ) : field.kind === "boolean" ? (
          <label className="work-toggle">
            <input
              id={id}
              type="checkbox"
              checked={Boolean(val)}
              disabled={busy}
              onChange={(e) => set(field.key, e.target.checked)}
            />
            <span>{Boolean(val) ? "Enabled" : "Disabled"}</span>
          </label>
        ) : field.kind === "select" ? (
          <select
            id={id}
            value={String(val || "")}
            disabled={busy || isReadonly}
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => set(field.key, e.target.value)}
          >
            <option value="" disabled={field.required}>
              Choose {field.label.toLowerCase()}…
            </option>
            {field.options?.map((value) => (
              <option value={value} key={value}>
                {humanLabel(value)}
              </option>
            ))}
          </select>
        ) : field.kind === "textarea" ? (
          <Textarea
            id={id}
            value={String(val || "")}
            disabled={busy}
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => set(field.key, e.target.value)}
            rows={3}
          />
        ) : (
          <Input
            id={id}
            type={field.kind === "date" ? "date" : "text"}
            inputMode={field.kind === "number" ? "decimal" : undefined}
            suffix={suffix}
            prefix={prefix}
            aria-describedby={id + "-help"}
            numberFormat={field.kind === "raw" ? "raw" : "localized"}
            value={String(val ?? "")}
            disabled={busy || isReadonly}
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => set(field.key, e.target.value)}
          />
        )}
        <small id={id + "-help"}>
          {field.hint ||
            (field.kind === "number"
              ? suffix === "Select unit"
                ? "Choose the material, product or unit first."
                : "Use a comma for decimals."
              : "")}
        </small>
        {error && (
          <small className="work-field-error" role="alert">
            {error.message}
          </small>
        )}
      </div>
    );
  }
  return (
    <ERPModal
      title={
        row && action.startsWith("save_")
          ? command.label.replace(/^New /, "Edit ")
          : command.label
      }
      description={row?.label || ""}
      onClose={onClose}
      dirty={dirty}
    >
      <form
        ref={form}
        className="erp-form work-command"
        data-dirty={dirty ? "true" : undefined}
        aria-busy={busy}
        onSubmit={submit}
        noValidate
      >
        <div className="erp-form-body">
          <details
            className="work-command-help"
            open={command.confirm || undefined}
          >
            <summary>
              <Info className="size-4 shrink-0" />
              About this form
            </summary>
            <p>{command.help}</p>
          </details>
          <div className="work-field-grid">
            {command.fields.map((field) =>
              renderField(field, field.key, values, update),
            )}
          </div>
          {failure && (
            <div className="work-form-error" role="alert">
              {failure}
            </div>
          )}
        </div>
        <div className="erp-form-actions work-form-footer">
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              if (
                !dirty ||
                (await confirm({
                  title: "Discard changes?",
                  description: "Your unsaved changes will be lost.",
                  confirmLabel: "Discard changes",
                }))
              )
                onClose();
            }}
          >
            Cancel
          </Button>
          {command.confirm ? (
            <SlideConfirm
              label={command.label}
              busy={busy}
              resetKey={JSON.stringify(values)}
              onConfirm={() => {
                confirmed.current = true;
                void submit();
              }}
            />
          ) : (
            <Button type="submit" loading={busy}>
              {busy ? "Saving…" : "Save"}
              <ArrowRight className="size-3.5" />
            </Button>
          )}
        </div>
      </form>
    </ERPModal>
  );
}
