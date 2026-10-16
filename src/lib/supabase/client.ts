import { PostgrestClient } from '@supabase/postgrest-js';

/** All browser reads pass through the session-authorized, read-only gateway. */
export function createClient() {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  return new PostgrestClient(`${origin}/api/data`, {
    fetch: (input, init) => fetch(input, { ...init, credentials: 'same-origin', cache: 'no-store' }),
  });
}
