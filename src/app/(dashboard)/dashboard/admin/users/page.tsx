"use client";
import { BUSINESS_ROLES, roleLabel } from "@/lib/rbac";
import { AccessPreview } from "@/components/erp/access-preview";
import { RowActions } from "@/components/workspace/row-actions";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Pencil, KeyRound, Users, RefreshCw } from "lucide-react";
import { useUser } from "@/app/(dashboard)/user-context";
import type { User, UserRole } from "@/lib/types";
import { canAction } from "@/lib/types";
import {
  saveUserAction,
  resetUserPasswordAction,
} from "@/lib/actions/user-actions";
import { toast } from "sonner";
import {
  PageHeader,
  DataToolbar,
  DataPagination,
  EmptyState,
} from "@/components/workspace/page-ui";
import { CopyValue } from "@/components/workspace/data-tools";
import { DomainDialog } from "@/components/workspace/domain-dialog";
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
const roles = BUSINESS_ROLES;
const blank = {
  username: "",
  nama_lengkap: "",
  role: "viewer" as UserRole,
  is_active: true,
  password: "",
};
export default function UsersPage() {
  const { user } = useUser(),
    [data, setData] = useState<User[]>([]),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [total, setTotal] = useState(0),
    [pageOffset, setPageOffset] = useState(0),
    [more, setMore] = useState(false);
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<User | null>(null),
    [form, setForm] = useState(blank),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const [resetTarget, setResetTarget] = useState<User | null>(null),
    [temporary, setTemporary] = useState("");
  const seq = useRef(0);
  const allowed = Boolean(user && canAction(user, "manage_users"));
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const load = useCallback(
    async (offset = 0) => {
      const id = ++seq.current;
      if (offset) setMore(true);
      else setLoading(true);
      try {
        const r = await fetch(
          "/api/admin/users?" +
            new URLSearchParams({ q: query, offset: String(offset) }),
        );
        const result = await r.json();
        if (id !== seq.current) return;
        if (!r.ok) throw Error(result.message);
        setData(result.data);
        setPageOffset(offset);
        setTotal(result.count || 0);
        setError("");
      } catch (e) {
        if (id === seq.current) {
          if (!offset) {
            setError(e instanceof Error ? e.message : "Could not load users.");
            setData([]);
          } else toast.error("Could not load this page of users.");
        }
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setMore(false);
        }
      }
    },
    [query],
  );
  useEffect(() => {
    const sequence = seq;
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [load]);
  function edit(u: User | null) {
    setEditing(u);
    setForm(
      u
        ? {
            username: u.username,
            nama_lengkap: u.nama_lengkap,
            role: u.role,
            is_active: u.is_active !== false,
            password: "",
          }
        : { ...blank },
    );
    setFormError("");
    setOpen(true);
  }
  if (!allowed)
    return (
      <EmptyState
        error
        title="Access restricted"
        description="Only administrators and QC admins can manage users."
      />
    );
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Manage accounts, roles, and access."
      >
        <Button onClick={() => edit(null)}>
          <Plus className="size-4" />
          Add user
        </Button>
      </PageHeader>
      <DataToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search names or usernames…"
        total={total}
        loading={loading}
        onRefresh={() => void load()}
      />
      <div className="data-card">
        <Table data-actions>
          <TableHeader>
            <TableRow>
              <TableHead>Users</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Password</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeleton rows={5} cols={5} />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    error
                    title="Could not load users"
                    description={error}
                  >
                    <Button onClick={() => void load()} variant="outline">
                      <RefreshCw className="size-4" />
                      Retry
                    </Button>
                  </EmptyState>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    title="No matching users"
                    description="Try another search."
                  />
                </TableCell>
              </TableRow>
            ) : (
              data.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="font-medium">
                      {u.nama_lengkap}
                      {u.id === user?.id && (
                        <span className="ml-2 text-xs text-muted">You</span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      @{u.username}
                      <CopyValue value={u.username} label="Copy username" />
                    </p>
                  </TableCell>
                  <TableCell>{roleLabel(u.role)}</TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? "default" : "secondary"}>
                      {u.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted">
                    {u.must_change_password ? "Change required" : "Set"}
                  </TableCell>
                  <TableCell>
                    <RowActions>
                      <button
                        type="button"
                        className="row-action"
                        title="Edit user"
                        onClick={() => edit(u)}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {u.id !== user?.id && (
                        <button
                          type="button"
                          className="row-action"
                          title="Reset password"
                          onClick={() => {
                            setTemporary("");
                            setFormError("");
                            setResetTarget(u);
                          }}
                        >
                          <KeyRound className="size-3.5" />
                        </button>
                      )}
                    </RowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {!loading && !error && (
        <DataPagination
          count={data.length}
          total={total}
          loading={more}
          page={Math.floor(pageOffset / 50) + 1}
          pageSize={50}
          onPageChange={(p) => void load((p - 1) * 50)}
        />
      )}
      <DomainDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setForm({ ...blank });
        }}
        busy={busy}
        dirtyValue={form}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <Users className="mb-3 size-5 text-muted" />
            <DialogTitle>{editing ? "Edit user" : "Add user"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Role changes and deactivation end the user's sessions."
                : "The user must change their temporary password at first sign-in."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="mt-5 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setFormError("");
              try {
                const payload = editing
                  ? {
                      id: editing.id,
                      nama_lengkap: form.nama_lengkap,
                      role: form.role,
                      is_active: form.is_active,
                    }
                  : {
                      username: form.username,
                      nama_lengkap: form.nama_lengkap,
                      role: form.role,
                      password: form.password,
                    };
                const r = await saveUserAction(payload);
                if (!r.ok) {
                  setFormError(r.error || "Could not save the account.");
                  return;
                }
                setOpen(false);
                setForm({ ...blank });
                toast.success("User saved.");
                void load();
              } catch {
                setFormError("Connection lost. Retry.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="form-label">
              Full name
              <Input
                value={form.nama_lengkap}
                onChange={(e) =>
                  setForm((v) => ({ ...v, nama_lengkap: e.target.value }))
                }
                required
                maxLength={200}
              />
            </label>
            <label className="form-label">
              Username
              <Input
                value={form.username}
                onChange={(e) =>
                  setForm((v) => ({ ...v, username: e.target.value }))
                }
                disabled={Boolean(editing)}
                required
                maxLength={100}
                autoComplete="off"
              />
            </label>
            <label className="form-label">
              Role
              <select
                value={form.role}
                disabled={editing?.id === user?.id}
                onChange={(e) =>
                  setForm((v) => ({ ...v, role: e.target.value as UserRole }))
                }
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
              <small className="text-muted">
                Changing role clears user-specific overrides and signs out
                existing sessions. Administrators retain full access.
              </small>
            </label>
            <AccessPreview
              role={form.role}
              userId={editing?.role === form.role ? editing.id : undefined}
            />
            {editing ? (
              <label className="form-label">
                Access status
                <select
                  value={String(form.is_active)}
                  disabled={editing.id === user?.id}
                  onChange={(e) =>
                    setForm((v) => ({
                      ...v,
                      is_active: e.target.value === "true",
                    }))
                  }
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </label>
            ) : (
              <label className="form-label">
                Temporary password
                <Input
                  aria-label="Temporary password"
                  type="password"
                  value={form.password}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, password: e.target.value }))
                  }
                  required
                  minLength={16}
                  maxLength={1024}
                  autoComplete="new-password"
                />
                <span className="form-hint">
                  At least 16 characters. Share it securely with the user.
                </span>
              </label>
            )}
            {formError && (
              <p role="alert" className="text-xs text-danger">
                {formError}
              </p>
            )}
            <DialogFooter className="mt-6">
              <DialogClose
                render={
                  <Button variant="outline" disabled={busy}>
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" loading={busy}>
                Save user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </DomainDialog>
      <DomainDialog
        open={Boolean(resetTarget)}
        onOpenChange={(v) => {
          if (!v) {
            setResetTarget(null);
            setTemporary("");
          }
        }}
        busy={busy}
        dirtyValue={temporary}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a temporary password for @{resetTarget?.username}. All
              sessions will end.
            </DialogDescription>
          </DialogHeader>
          <form
            className="mt-4 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!resetTarget) return;
              setBusy(true);
              setFormError("");
              try {
                const r = await resetUserPasswordAction({
                  id: resetTarget.id,
                  password: temporary,
                });
                if (!r.ok) {
                  setFormError(r.error || "Could not reset the password.");
                  return;
                }
                setResetTarget(null);
                setTemporary("");
                toast.success(
                  "Password reset. The user must change it at sign-in.",
                );
                void load();
              } catch {
                setFormError("Connection lost. Retry.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="form-label">
              Temporary password
              <Input
                aria-label="Temporary password"
                type="password"
                autoComplete="new-password"
                value={temporary}
                onChange={(e) => setTemporary(e.target.value)}
                required
                minLength={16}
                maxLength={1024}
              />
            </label>
            {formError && (
              <p role="alert" className="text-xs text-danger">
                {formError}
              </p>
            )}
            <DialogFooter>
              <DialogClose
                render={
                  <Button variant="outline" disabled={busy}>
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" loading={busy}>
                Reset password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </DomainDialog>
    </div>
  );
}
