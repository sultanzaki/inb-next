"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Pencil, KeyRound, Users, RefreshCw } from "lucide-react";
import { useUser } from "../../user-context";
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
const roles: UserRole[] = [
  "viewer",
  "qc supervisor",
  "admin qc",
  "administrator inbionusa",
];
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
    [more, setMore] = useState(false);
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<User | null>(null),
    [form, setForm] = useState(blank),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const [resetTarget, setResetTarget] = useState<User | null>(null),
    [temporary, setTemporary] = useState("");
  const seq = useRef(0);
  const allowed = Boolean(user && canAction(user.role, "manage_users"));
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
        setData((prev) => (offset ? [...prev, ...result.data] : result.data));
        setTotal(result.count || 0);
        setError("");
      } catch (e) {
        if (id === seq.current) {
          if (!offset) {
            setError(e instanceof Error ? e.message : "Gagal memuat pengguna.");
            setData([]);
          } else toast.error("Gagal memuat pengguna berikutnya.");
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
        title="Akses terbatas"
        description="Administrasi pengguna hanya tersedia untuk administrator dan admin QC."
      />
    );
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administrasi"
        title="Pengguna"
        description="Akun, kewenangan, dan status akses tim."
      >
        <Button onClick={() => edit(null)}>
          <Plus className="size-4" />
          Tambah pengguna
        </Button>
      </PageHeader>
      <DataToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Cari nama atau username…"
        total={total}
        loading={loading}
        onRefresh={() => void load()}
      />
      <div className="data-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pengguna</TableHead>
              <TableHead>Peran</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Password</TableHead>
              <TableHead>Aksi</TableHead>
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
                    title="Pengguna belum berhasil dimuat"
                    description={error}
                  >
                    <Button onClick={() => void load()} variant="outline">
                      <RefreshCw className="size-4" />
                      Coba lagi
                    </Button>
                  </EmptyState>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    title="Tidak ada pengguna yang cocok"
                    description="Coba kata pencarian lain."
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
                        <span className="ml-2 text-xs text-muted">Anda</span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      @{u.username}
                      <CopyValue value={u.username} label="Salin username" />
                    </p>
                  </TableCell>
                  <TableCell>{u.role}</TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? "default" : "secondary"}>
                      {u.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted">
                    {u.must_change_password ? "Wajib diganti" : "Sudah diatur"}
                  </TableCell>
                  <TableCell>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="row-action"
                        title="Edit pengguna"
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
                    </div>
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
          onMore={() => void load(data.length)}
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
            <DialogTitle>
              {editing ? "Edit pengguna" : "Tambah pengguna"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Perubahan peran atau penonaktifan akan mencabut sesi pengguna terkait."
                : "Pengguna wajib mengganti password sementara setelah masuk pertama kali."}
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
                  setFormError(r.error || "Gagal menyimpan akun.");
                  return;
                }
                setOpen(false);
                setForm({ ...blank });
                toast.success("Pengguna berhasil disimpan.");
                void load();
              } catch {
                setFormError("Koneksi terputus. Coba lagi.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="form-label">
              Nama lengkap
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
              Peran
              <select
                value={form.role}
                disabled={editing?.id === user?.id}
                onChange={(e) =>
                  setForm((v) => ({ ...v, role: e.target.value as UserRole }))
                }
              >
                {roles.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            {editing ? (
              <label className="form-label">
                Status akses
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
                  <option value="true">Aktif</option>
                  <option value="false">Nonaktif</option>
                </select>
              </label>
            ) : (
              <label className="form-label">
                Password sementara
                <Input
                  aria-label="Password sementara"
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
                  Minimal 16 karakter. Berikan kepada pengguna melalui saluran
                  internal yang aman.
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
                    Batal
                  </Button>
                }
              />
              <Button type="submit" loading={busy}>
                Simpan pengguna
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
              Atur password sementara untuk @{resetTarget?.username}. Seluruh
              sesi akun tersebut akan diakhiri.
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
                  setFormError(r.error || "Gagal mereset password.");
                  return;
                }
                setResetTarget(null);
                setTemporary("");
                toast.success(
                  "Password direset. Pengguna wajib menggantinya setelah login.",
                );
                void load();
              } catch {
                setFormError("Koneksi terputus. Coba lagi.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="form-label">
              Password sementara
              <Input
                aria-label="Password sementara"
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
                    Batal
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
