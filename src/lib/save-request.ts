import { requestTimeout } from "./request-timeout";
export class SaveRequestError extends Error {
  constructor(
    message: string,
    public fields: { path: string; message: string }[] = [],
    public uncertain = false,
  ) {
    super(message);
  }
}
export async function saveRequest<T>(
  url: string,
  payload: unknown,
): Promise<T> {
  const timeout = requestTimeout(new AbortController().signal, 60_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: timeout.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw new SaveRequestError(
        data.message || "The server rejected these changes.",
        data.fields || [],
        response.status >= 500,
      );
    return data as T;
  } catch (error) {
    if (error instanceof SaveRequestError) throw error;
    throw new SaveRequestError(
      "The connection ended before the save could be confirmed.",
      [],
      true,
    );
  } finally {
    timeout.dispose();
  }
}
