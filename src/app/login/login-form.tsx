"use client";
import Image from "next/image";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { loginAction, type LoginState } from "./actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
const initial: LoginState = {};
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      loading={pending}
      className="h-12 w-full justify-between px-4"
    >
      <span>{pending ? "Menghubungkan ke ruang kerja…" : "Masuk"}</span>
      {!pending && <ArrowRight className="size-4" />}
    </Button>
  );
}
export function LoginForm() {
  const [state, action] = useActionState(loginAction, initial);
  const [show, setShow] = useState(false);
  return (
    <div className="login-form-card surface-enter">
      <div className="mb-10 flex items-center gap-3 lg:hidden">
        <Image
          src="/logo.png"
          alt="Logo INBIONUSA"
          width={36}
          height={36}
          priority
        />
        <span className="text-sm font-bold tracking-tight text-primary-deep">
          INBIONUSA
        </span>
      </div>
      <span className="mb-5 grid size-11 place-items-center rounded-xl border border-primary-line bg-primary-soft text-primary">
        <LockKeyhole className="size-5" />
      </span>
      <p className="mb-2 text-xs font-medium text-primary">
        Selamat datang kembali
      </p>
      <h1>
        Ruang kerja mutu Anda,
        <br />
        siap dilanjutkan.
      </h1>
      <p className="mt-4 text-[13px] leading-relaxed text-muted">
        Masuk dengan akun Anda untuk mengelola kualitas dari satu tempat.
      </p>
      <form action={action} className="mt-9 space-y-5">
        <div className="space-y-2">
          <label htmlFor="username" className="text-xs font-semibold">
            Username
          </label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              id="username"
              name="username"
              autoComplete="username"
              required
              maxLength={100}
              placeholder="Masukkan username"
              className="h-12 pl-11"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-xs font-semibold">
            Password
          </label>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              id="password"
              name="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={1024}
              placeholder="Masukkan password"
              className="h-12 pl-11 pr-12"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-1.5 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-alt hover:text-primary"
              aria-label={show ? "Sembunyikan password" : "Tampilkan password"}
              aria-pressed={show}
            >
              {show ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription id="login-error">{state.error}</AlertDescription>
          </Alert>
        )}
        <div className="pt-1">
          <SubmitButton />
        </div>
      </form>
      <p className="login-footer">
        Akses diberikan sesuai peran pengguna.
        <br />
        Butuh bantuan akun? Hubungi administrator internal Anda.
      </p>
    </div>
  );
}
