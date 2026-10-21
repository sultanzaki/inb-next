/** Compose cancellation and a timeout without requiring AbortSignal.any in older browsers. */
export function requestTimeout(parent: AbortSignal, milliseconds = 20000) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out.", "TimeoutError")),
    milliseconds,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}
