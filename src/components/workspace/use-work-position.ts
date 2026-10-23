"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@/app/(dashboard)/user-context";
type Position = {
  q: string;
  state: string;
  page: number;
  y?: number;
  x?: number;
};
export function useWorkPosition(
  entity: string,
  value: Position,
  restore: (value: Position) => void,
) {
  const { user } = useUser();
  const pathname = usePathname();
  const key = `inb:position:1:${user?.id}:${pathname}:${entity}`;
  const [readyKey, setReadyKey] = useState("");
  const latest = useRef({ value, restore });
  useEffect(() => {
    latest.current = { value, restore };
  });
  useEffect(() => {
    let active = false,
      cancelled = false,
      frame = 0;
    const timer = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(key);
        const saved = raw ? (JSON.parse(raw) as Position) : null;
        const params = new URLSearchParams(location.search);
        if (
          saved &&
          typeof saved.q === "string" &&
          typeof saved.state === "string" &&
          Number.isSafeInteger(saved.page) &&
          saved.page > 0 &&
          saved.page <= 1000000 &&
          !["q", "page", "state", "grid"].some((k) => params.has(k))
        ) {
          latest.current.restore(saved);
          const start = performance.now();
          const scroll = () => {
            if (cancelled) return;
            const y = Math.max(0, Number(saved.y) || 0);
            const table = document.querySelector<HTMLElement>(
              '[data-slot="table-container"]',
            );
            if (table) table.scrollLeft = Math.max(0, Number(saved.x) || 0);
            if (
              (document.documentElement.scrollHeight >= y + innerHeight &&
                (Number(saved.x || 0) === 0 ||
                  (table &&
                    table.scrollWidth - table.clientWidth >=
                      Number(saved.x)))) ||
              performance.now() - start > 2000
            ) {
              window.scrollTo(0, y);
              return;
            }
            frame = requestAnimationFrame(scroll);
          };
          frame = requestAnimationFrame(scroll);
        }
      } catch {
        /* A work position is optional. */
      }
      active = true;
      setReadyKey(key);
    }, 0);
    const cancel = () => {
      cancelled = true;
    };
    const save = () => {
      if (!active) return;
      try {
        const modal = document.querySelector(
          '[data-slot="dialog-content"][data-open]',
        );
        const old = JSON.parse(sessionStorage.getItem(key) || "{}");
        sessionStorage.setItem(
          key,
          JSON.stringify({
            ...latest.current.value,
            y: modal ? old.y || 0 : window.scrollY,
            x: modal
              ? old.x || 0
              : document.querySelector<HTMLElement>(
                  '[data-slot="table-container"]',
                )?.scrollLeft || 0,
          }),
        );
      } catch {}
    };
    window.addEventListener("pagehide", save);
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    const interval = setInterval(save, 1000);
    return () => {
      save();
      clearTimeout(timer);
      clearInterval(interval);
      cancelAnimationFrame(frame);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
    };
  }, [key]);
  return readyKey === key;
}
