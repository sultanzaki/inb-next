"use client";
import {
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "@/components/ui/button";
export type JourneyHandle = { beforeSubmit: () => boolean; reveal: () => void };
export function FormJourney({
  sections,
  ref,
}: {
  sections: { title: string; content: ReactNode }[];
  ref?: Ref<JourneyHandle>;
}) {
  const [step, setStep] = useState(0);
  const [all, setAll] = useState(() => {
    try {
      return (
        typeof window !== "undefined" &&
        localStorage.getItem("inb:form-layout") === "all"
      );
    } catch {
      return false;
    }
  });
  const root = useRef<HTMLDivElement>(null);
  const guided = sections.length > 1;
  const review = all || !guided || step === sections.length;
  function move(next: number) {
    setStep(next);
    requestAnimationFrame(() => {
      root.current?.scrollIntoView({ block: "start" });
      root.current
        ?.querySelector<HTMLElement>(
          '[data-step-active="true"] input, [data-step-active="true"] button, [data-step-active="true"] textarea',
        )
        ?.focus({ preventScroll: true });
    });
  }
  useImperativeHandle(ref, () => ({
    beforeSubmit() {
      if (review) return true;
      move(step + 1);
      return false;
    },
    reveal() {
      setAll(true);
    },
  }));
  return (
    <div ref={root} className="form-journey" data-review={review}>
      {guided && (
        <>
          <div className="form-journey-heading">
            <strong>
              {all
                ? "All fields"
                : step === sections.length
                  ? "Review before saving"
                  : `Step ${step + 1} of ${sections.length + 1}`}
            </strong>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = !all;
                setAll(next);
                try {
                  localStorage.setItem(
                    "inb:form-layout",
                    next ? "all" : "guided",
                  );
                } catch {}
              }}
            >
              {" "}
              {all ? "Use guided form" : "Show all fields"}
            </Button>
          </div>
          {!all && (
            <nav aria-label="Form steps" className="form-step-nav">
              {[...sections.map((s) => s.title), "Review"].map((title, i) => (
                <button
                  key={title}
                  type="button"
                  aria-current={step === i ? "step" : undefined}
                  onClick={() => move(i)}
                >
                  {i + 1}. {title}
                </button>
              ))}
            </nav>
          )}
          {!all && step === sections.length && (
            <p className="erp-notice">
              Review the information below. Nothing is submitted until you save
              or confirm.
            </p>
          )}
        </>
      )}
      {sections.map((section, i) => (
        <section
          key={section.title}
          hidden={!review && step !== i}
          data-step-active={review || step === i}
          className="form-step-content"
          aria-label={section.title}
        >
          {guided && review && <h3>{section.title}</h3>}
          {section.content}
        </section>
      ))}
      {guided && !all && (
        <div className="form-step-actions">
          <Button
            variant="outline"
            disabled={step === 0}
            onClick={() => move(step - 1)}
          >
            Previous step
          </Button>
          {!review && (
            <Button onClick={() => move(step + 1)}>
              {step === sections.length - 1 ? "Review information" : "Continue"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
