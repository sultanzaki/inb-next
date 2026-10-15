'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Eye, EyeOff } from 'lucide-react';
import { loginAction, type LoginState } from './actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';

const initialLoginState: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 w-full rounded-md bg-primary text-[13.5px] font-medium text-primary-foreground
        transition-colors duration-150 hover:bg-primary-dark
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30
        active:translate-y-[0.5px]
        disabled:pointer-events-none disabled:opacity-50"
    >
      {pending ? 'Memeriksa...' : 'Masuk'}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialLoginState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="w-full max-w-sm">
      <img
        src="/logo.png"
        alt="INBIONUSA"
        width={32}
        height={32}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
        className="mb-6 h-8 w-8 object-contain"
      />
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        Masuk
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Selamat datang kembali
      </h1>

      <form action={formAction} className="mt-8 space-y-4">
        <div className="space-y-1">
          <label htmlFor="username" className="text-xs font-medium">Username</label>
          <Input
            id="username"
            name="username"
            type="text"
            required
            autoFocus
            placeholder="Masukkan username"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-xs font-medium">Password</label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="Masukkan password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
              aria-pressed={showPassword}
              className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center text-faint
                transition-colors duration-150 hover:text-foreground
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {showPassword
                ? <EyeOff className="size-4" aria-hidden="true" />
                : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <SubmitButton />
      </form>
    </div>
  );
}
