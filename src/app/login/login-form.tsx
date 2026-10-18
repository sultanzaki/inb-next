"use client";
import Image from "next/image";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
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
      <span>{pending ? "Opening workspace…" : "Sign in"}</span>
      {!pending && <ArrowRight className="size-4" />}
    </Button>
  );
}
export function LoginForm() {
  const [state, action] = useActionState(loginAction, initial);
  const [show, setShow] = useState(false);
  return (
    <div className="login-form-card surface-enter">
      <div className="login-mobile-brand">
        <Image
          src="/logo.png"
          alt="INBIONUSA logo"
          width={36}
          height={36}
          priority
        />
        <span className="text-sm font-bold tracking-tight text-primary-deep">
          INBIONUSA
        </span>
      </div>
      <p className="mb-3 text-xs font-medium text-muted">INBIONUSA account</p>
      <h1>Welcome back.</h1>
      <p className="mt-4 text-[13px] leading-relaxed text-muted">
        Sign in to your INBIONUSA workspace.
      </p>
      <form action={action} className="mt-8 space-y-5">
        <div className="space-y-2">
          <label htmlFor="username" className="text-xs font-semibold">
            Username
          </label>
          <div className="relative">
            <Input
              id="username"
              name="username"
              autoComplete="username"
              required
              maxLength={100}
              placeholder="Enter your username"
              className="h-12 px-3.5"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-xs font-semibold">
            Password
          </label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={1024}
              placeholder="Enter your password"
              className="h-12 pl-3.5 pr-12"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-1.5 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-alt hover:text-primary"
              aria-label={show ? "Hide password" : "Show password"}
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
      <p className="login-footer">Need access? Contact your administrator.</p>
    </div>
  );
}
