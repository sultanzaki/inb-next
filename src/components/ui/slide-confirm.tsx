"use client";
import { useId, useRef, useState } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";

/** Only a completed thumb drag (or deliberate keyboard sequence) confirms. */
type SlideConfirmProps = {
  label?: string;
  onConfirm: () => void;
  disabled?: boolean;
  busy?: boolean;
  destructive?: boolean;
  resetKey?: string;
};
export function SlideConfirm(props: SlideConfirmProps) {
  return (
    <SlideConfirmControl
      key={`${props.resetKey ?? ""}:${Boolean(props.disabled)}:${Boolean(props.busy)}`}
      {...props}
    />
  );
}
function SlideConfirmControl({
  label = "Confirm",
  onConfirm,
  disabled = false,
  busy = false,
  destructive = false,
}: SlideConfirmProps) {
  const track = useRef<HTMLDivElement>(null),
    drag = useRef<{ id: number; x: number; distance: number } | null>(null),
    progressRef = useRef(0);
  const [progress, setProgress] = useState(0),
    [dragging, setDragging] = useState(false);
  const hint = useId();
  function update(value: number) {
    progressRef.current = value;
    setProgress(value);
  }
  function reset() {
    drag.current = null;
    setDragging(false);
    update(0);
  }

  function complete() {
    if (disabled || busy) return;
    reset();
    onConfirm();
  }
  return (
    <div className="slide-confirm-wrap">
      <div
        ref={track}
        className={`slide-confirm${destructive ? " is-destructive" : ""}${disabled || busy ? " is-disabled" : ""}${dragging ? " is-dragging" : ""}`}
        style={{ "--slide-progress": progress / 100 } as React.CSSProperties}
      >
        <span className="slide-confirm-fill" aria-hidden="true" />
        <span className="slide-confirm-label" aria-hidden="true">
          {busy
            ? "Processing…"
            : progress >= 98
              ? "Release to confirm"
              : `Slide to ${label.toLowerCase()}`}
        </span>
        <div
          role="slider"
          tabIndex={disabled || busy ? -1 : 0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-valuetext={`${Math.round(progress)}% · ${label}`}
          aria-orientation="horizontal"
          aria-disabled={disabled || busy}
          aria-describedby={hint}
          className="slide-confirm-thumb"
          onPointerDown={(e) => {
            if (disabled || busy || !e.isPrimary || e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              id: e.pointerId,
              x: e.clientX,
              distance: Math.max(1, (track.current?.clientWidth || 0) - 56),
            };
            update(0);
            setDragging(true);
          }}
          onPointerMove={(e) => {
            if (drag.current?.id === e.pointerId)
              update(
                Math.max(
                  0,
                  Math.min(
                    100,
                    ((e.clientX - drag.current.x) / drag.current.distance) *
                      100,
                  ),
                ),
              );
          }}
          onPointerUp={(e) => {
            if (drag.current?.id !== e.pointerId) return;
            const done = progressRef.current >= 98;
            reset();
            if (done) complete();
          }}
          onPointerCancel={reset}
          onLostPointerCapture={() => {
            if (drag.current) reset();
          }}
          onBlur={reset}
          onKeyDown={(e) => {
            if (disabled || busy) return;
            if (
              [
                "ArrowRight",
                "ArrowLeft",
                "Home",
                "End",
                "Escape",
                "Enter",
                " ",
              ].includes(e.key)
            )
              e.preventDefault();
            if (e.repeat && (e.key === "Enter" || e.key === " ")) return;
            if (e.key === "ArrowRight")
              update(Math.min(100, progressRef.current + 10));
            else if (e.key === "ArrowLeft")
              update(Math.max(0, progressRef.current - 10));
            else if (e.key === "End") update(100);
            else if (e.key === "Home" || e.key === "Escape") reset();
            else if (
              (e.key === "Enter" || e.key === " ") &&
              progressRef.current === 100
            )
              complete();
          }}
        >
          {busy ? (
            <LoaderCircle className="size-5 animate-spin" />
          ) : progress >= 98 ? (
            <Check className="size-5" />
          ) : (
            <ArrowRight className="size-5" />
          )}
        </div>
      </div>
      <p id={hint} className="slide-confirm-hint">
        Drag the handle to the end and release. Keyboard: End, then Enter.
      </p>
    </div>
  );
}
