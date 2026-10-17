"use client";
import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import type { z } from "zod";
import { CircleAlert } from "lucide-react";

type Errors = Record<string, string>;
const FormErrors = createContext<Errors>({});
export function DomainForm({
  value,
  schema,
  onSubmit,
  children,
}: {
  value: unknown;
  schema: z.ZodType;
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [errors, setErrors] = useState<Errors>({});
  const ref = useRef<HTMLFormElement>(null);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = schema.safeParse(value);
    if (!result.success) {
      const next: Errors = {};
      for (const issue of result.error.issues)
        next[issue.path.join(".") || "_form"] ??=
          issue.code === "invalid_format" && issue.format === "uuid"
            ? "Choose a valid value."
            : issue.code === "invalid_format" && issue.format === "date"
              ? "Enter a valid date."
              : issue.message;
      setErrors(next);
      requestAnimationFrame(() =>
        ref.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(),
      );
      return;
    }
    setErrors({});
    void onSubmit();
  }
  return (
    <FormErrors value={errors}>
      <form
        ref={ref}
        onSubmit={submit}
        aria-label="Quality data form"
        noValidate
        className="contents"
        onChange={(e) => {
          const target = e.target;
          const name =
            target instanceof HTMLInputElement ||
            target instanceof HTMLSelectElement ||
            target instanceof HTMLTextAreaElement
              ? target.name
              : "";
          if (errors[name] || errors._form)
            setErrors((prev) => {
              const next = { ...prev };
              delete next[name];
              delete next._form;
              return next;
            });
        }}
      >
        {Object.keys(errors).length > 0 && (
          <div role="alert" className="form-summary-error mx-6 mt-4">
            <CircleAlert className="size-4 shrink-0" />
            <span>
              {errors._form ||
                Object.values(errors)
                  .filter(
                    (message, index, all) => all.indexOf(message) === index,
                  )
                  .join(" ")}
            </span>
          </div>
        )}
        {children}
      </form>
    </FormErrors>
  );
}
export function Field({
  label,
  name,
  hint,
  children,
  className = "",
  required,
}: {
  label: string;
  name: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  const id = useId();
  const errors = useContext(FormErrors);
  const error = errors[name];
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        name,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error || hint ? `${id}-hint` : undefined,
        required,
      })
    : children;
  return (
    <div className={`space-y-2 ${className}`}>
      <label htmlFor={id} className="block text-xs font-medium text-text">
        {label.replace(/\s*\*$/, "")}
        {(required || label.endsWith("*")) && (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {control}
      {error ? (
        <p id={`${id}-hint`} className="field-error">
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="form-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
