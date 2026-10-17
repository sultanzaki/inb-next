/** Compare the browser Origin against the public Host, not Next's internal listen address. */
export function sameOrigin(
  origin: string | null,
  host: string | null,
  protocol: string,
) {
  if (!origin) return true;
  if (!host || !["http", "https"].includes(protocol)) return false;
  try {
    const value = new URL(origin);
    return (
      value.origin === origin &&
      value.origin === new URL(`${protocol}://${host}`).origin
    );
  } catch {
    return false;
  }
}
