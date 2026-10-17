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
          {forced ? "Set a new password" : "Change password"}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          {forced
            ? "Change your temporary password to continue."
            : "Use at least 16 characters. Other sessions will end."}
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
                setError(r.error || "Could not change the password.");
                return;
              }
              setValues({
                current_password: "",
                password: "",
                confirmation: "",
              });
              toast.success("Password changed.");
              router.replace("/dashboard");
              router.refresh();
            } catch {
              setError("Connection lost. Retry.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {(
            [
              ["current_password", "Current password", "current-password"],
              ["password", "New password", "new-password"],
              ["confirmation", "Confirm new password", "new-password"],
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
            Save password
          </Button>
        </form>
        <div className="mt-6 flex justify-between text-xs">
          {!forced && (
            <Link href="/dashboard" className="text-primary">
              Back to dashboard
            </Link>
          )}
          <button
            disabled={busy}
            onClick={() => void logoutAction()}
            className="text-muted"
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
