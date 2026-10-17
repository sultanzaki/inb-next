"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { changePasswordAction } from "@/lib/actions/user-actions";
import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
export function PasswordForm({
  forced,
  username,
}: {
  forced: boolean;
  username: string;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [values, setValues] = useState({
      current_password: "",
      password: "",
      confirmation: "",
    });
  return (
    <main className="password-page">
      <div className="password-card">
        <Image src="/logo.png" alt="INBIONUSA" width={44} height={44} />
        <p className="mt-7 text-xs text-muted">@{username}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {forced ? "Buat password baru." : "Ganti password."}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          {forced
            ? "Administrator telah membuat atau mereset akses Anda. Ganti password sebelum melanjutkan."
            : "Gunakan minimal 16 karakter. Setelah berhasil, sesi lain akan diakhiri."}
        </p>
        <form
          className="mt-8 space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await changePasswordAction(values);
              if (!r.ok) {
                setError(r.error || "Gagal mengubah password.");
                return;
              }
              setValues({
                current_password: "",
                password: "",
                confirmation: "",
              });
              toast.success("Password berhasil diperbarui.");
              router.replace("/dashboard");
              router.refresh();
            } catch {
              setError("Koneksi terputus. Coba lagi.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {(
            [
              ["current_password", "Password saat ini", "current-password"],
              ["password", "Password baru", "new-password"],
              ["confirmation", "Ulangi password baru", "new-password"],
            ] as const
          ).map(([name, label, autocomplete]) => (
            <label key={name} className="block space-y-2 text-xs font-medium">
              <span>{label}</span>
              <Input
                type="password"
                name={name}
                autoComplete={autocomplete}
                required
                minLength={name === "current_password" ? 1 : 16}
                maxLength={1024}
                value={values[name]}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [name]: e.target.value }))
                }
              />
            </label>
          ))}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" loading={busy} className="w-full">
            Simpan password
          </Button>
        </form>
        <div className="mt-6 flex justify-between text-xs">
          {!forced && (
            <Link href="/dashboard" className="text-primary">
              Kembali ke dashboard
            </Link>
          )}
          <button
            disabled={busy}
            onClick={() => void logoutAction()}
            className="text-muted"
          >
            Logout
          </button>
        </div>
      </div>
    </main>
  );
}
