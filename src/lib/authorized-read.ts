import { privateJson } from "./api-response";

/** Only for reads whose database RPC independently enforces session and RBAC.
 * Never release a response until the application session check has succeeded.
 * Writes and audit events must still await the session before running.
 */
export async function authorizedRead<T>(
  authorize: () => Promise<T | null>,
  read: (session: Promise<T | null>) => Promise<Response>,
) {
  const start = performance.now();
  let authMs = 0,
    readMs = 0;
  const session = authorize().finally(() => {
    authMs = performance.now() - start;
  });
  const result = read(session).finally(() => {
    readMs = performance.now() - start;
  });
  // Observe failures immediately, even if authentication denies access first.
  const outcome = result.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
  const user = await session;
  if (!user) return privateJson({ message: "Session expired." }, 401);
  const response = await outcome;
  if (response.status === "rejected") throw response.reason;
  response.value.headers.set(
    "Server-Timing",
    `session;dur=${authMs.toFixed(1)}, read;dur=${readMs.toFixed(1)}, total;dur=${(performance.now() - start).toFixed(1)}`,
  );
  return response.value;
}
