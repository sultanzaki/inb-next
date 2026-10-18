"use client";
import { useERPPage } from "./data";
import { ERPActionButton } from "./shared";
export function AccessPreview({
  role,
  userId,
}: {
  role: string;
  userId?: string;
}) {
  const result = useERPPage(
    userId ? "effective_access" : "role_access",
    role,
    "",
    1,
    userId,
  );
  return (
    <details className="access-preview">
      <summary>
        {userId ? "View effective access" : "View role defaults"}
      </summary>
      <p>
        Explicit exceptions replace role defaults. Module mode can further
        restrict access.
      </p>
      {result.error ? (
        <p role="alert">{result.error}</p>
      ) : result.loading ? (
        <p role="status">Loading access…</p>
      ) : (
        <div className="access-preview-rows">
          {result.data.rows.map((r) => (
            <div key={r.id}>
              <strong>{r.name}</strong>
              <span>
                Read {r.can_read ? "✓" : "—"} · Write {r.can_write ? "✓" : "—"}{" "}
                · Approve {r.can_approve ? "✓" : "—"}
              </span>
              <small>
                {r.source} · {r.state}
              </small>
              {userId && r.source === "User override" && (
                <ERPActionButton
                  action="reset_access"
                  payload={{ user_id: userId, module: r.id }}
                  onDone={() => result.refresh()}
                >
                  Restore role default
                </ERPActionButton>
              )}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
