import { requestTimeout } from "../request-timeout";
import type { ERPPage } from "./schema";

type Pending = {
  promise: Promise<ERPPage>;
  controller: AbortController;
  readers: number;
};
const pending = new Map<string, Pending>();

export function invalidateERPReads() {
  pending.clear();
}

/** Share only concurrent reads, never fulfilled financial data or permissions. */
export function readERPPage(
  url: string,
  signal: AbortSignal,
): Promise<ERPPage> {
  if (signal.aborted) return Promise.reject(signal.reason);
  let entry = pending.get(url);
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController();
    const timeout = requestTimeout(controller.signal);
    const created: Pending = {
      controller,
      readers: 0,
      promise: fetch(url, { signal: timeout.signal, cache: "no-store" })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok)
            throw Error(data.message || "Could not load records.");
          return data as ERPPage;
        })
        .finally(() => {
          timeout.dispose();
          if (pending.get(url) === created) pending.delete(url);
        }),
    };
    entry = created;
    pending.set(url, entry);
  }
  const current = entry;
  current.readers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      current.readers--;
      // Allow a replacement subscriber in the same React effect cycle to join.
      queueMicrotask(() => {
        if (current.readers === 0) {
          if (pending.get(url) === current) pending.delete(url);
          current.controller.abort();
        }
      });
    };
    const abort = () => {
      release();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    current.promise.then(
      (data) => {
        if (!finished) {
          release();
          resolve(data);
        }
      },
      (error) => {
        if (!finished) {
          release();
          reject(error);
        }
      },
    );
  });
}
