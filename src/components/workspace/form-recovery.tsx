"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useUser } from "@/app/(dashboard)/user-context";
import { Button } from "@/components/ui/button";

type Snapshot = {
  version: 1;
  savedAt: number;
  values: Record<string, unknown>;
};
type Session = {
  restored: Record<string, unknown>;
  update: (key: string, value: unknown, initial: unknown) => void;
  clear: () => void;
  notice: ReactNode;
};
const Context = createContext<Session | null>(null);
const expiry = 7 * 86400000;
export function FormRecovery({
  scope,
  children,
  recordId,
}: {
  scope: string;
  children: ReactNode;
  recordId?: string;
}) {
  const outer = useContext(Context);
  const { user } = useUser();
  const path = usePathname(),
    params = useSearchParams();
  const record = recordId ?? params.get("record") ?? "new";
  const identity =
    recordId === undefined && params.get("record") ? "record" : scope;
  return outer ? (
    children
  ) : (
    <RecoverySession
      key={`${user?.id}:${path}:${record}:${identity}`}
      scope={identity}
      record={record}
    >
      {children}
    </RecoverySession>
  );
}
function RecoverySession({
  scope,
  children,
  record,
}: {
  scope: string;
  children: ReactNode;
  record: string;
}) {
  const { user } = useUser();
  const pathname = usePathname();
  const storageKey = `inb:draft:1:${user?.id}:${pathname}:${record}:${scope}`;
  const [candidate, setCandidate] = useState<Snapshot | null>(null);
  const [restored, setRestored] = useState<Record<string, unknown>>({});
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState("");
  const state = useRef({
    values: {} as Record<string, unknown>,
    initial: {} as Record<string, unknown>,
    pending: true,
    cleared: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const task = setTimeout(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        const saved = raw ? (JSON.parse(raw) as Snapshot) : null;
        if (
          saved?.version === 1 &&
          saved.values &&
          typeof saved.values === "object" &&
          Date.now() - saved.savedAt < expiry
        )
          setCandidate(saved);
        else {
          localStorage.removeItem(storageKey);
          state.current.pending = false;
        }
      } catch {
        state.current.pending = false;
        setStatus("Draft recovery is unavailable in this browser.");
      }
    }, 0);
    return () => clearTimeout(task);
  }, [storageKey]);
  const session = useMemo(() => {
    function flush() {
      if (!user?.id || state.current.pending || state.current.cleared) return;
      if (
        JSON.stringify(state.current.values) ===
        JSON.stringify(state.current.initial)
      )
        return;
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            version: 1,
            savedAt: Date.now(),
            values: state.current.values,
          }),
        );
        setStatus("Draft saved on this device.");
      } catch {
        setStatus("Could not save a recovery draft. Keep this form open.");
      }
    }
    return {
      restored,
      update(key: string, value: unknown, initial: unknown) {
        if (JSON.stringify(value) !== JSON.stringify(initial))
          state.current.cleared = false;
        state.current.values[key] = value;
        state.current.initial[key] = initial;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 400);
      },
      clear() {
        state.current.cleared = true;
        state.current.values = {};
        state.current.initial = {};
        if (timer.current) clearTimeout(timer.current);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* Optional device storage. */
        }
      },
      flush,
    };
  }, [storageKey, restored, user?.id]);
  useEffect(() => {
    const flush = () => session.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      session.flush();
      window.removeEventListener("pagehide", flush);
    };
  }, [session]);
  const notice = candidate ? (
    <aside className="draft-recovery" role="status">
      <div>
        <strong>Resume your draft?</strong>
        <p>
          Saved on this device{" "}
          {new Date(candidate.savedAt).toLocaleString("en-GB")}. Review current
          stock, prices and dates before saving.
        </p>
      </div>
      <Button
        size="sm"
        onClick={() => {
          state.current.pending = false;
          setRestored(candidate.values);
          setGeneration((v) => v + 1);
          setCandidate(null);
        }}
      >
        Restore draft
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          try {
            localStorage.removeItem(storageKey);
          } catch {}
          state.current.pending = false;
          setCandidate(null);
        }}
      >
        Discard draft
      </Button>
    </aside>
  ) : status ? (
    <p className="draft-status" role="status">
      {status}
    </p>
  ) : null;
  return (
    <Context value={{ ...session, notice }}>
      <div key={generation} className="recovery-content">
        {children}
      </div>
    </Context>
  );
}
export function useOperatorState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const session = useContext(Context);
  const [baseline] = useState(initial);
  const [value, setValue] = useState<T>(() =>
    session && Object.hasOwn(session.restored, key)
      ? (session.restored[key] as T)
      : baseline,
  );
  const update = session?.update;
  useEffect(() => {
    update?.(key, value, baseline);
  }, [update, key, value, baseline]);
  return [value, setValue];
}
export function useFormRecovery() {
  return useContext(Context);
}
export function RecoveryNotice() {
  return useFormRecovery()?.notice;
}
