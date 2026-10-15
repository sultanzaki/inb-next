'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { loginAction, type LoginState } from './actions';
import { Alert, AlertDescription } from '@/components/ui/alert';

const initialLoginState: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold
        transition-all duration-150 active:scale-[0.98] cursor-pointer
        disabled:opacity-60 disabled:pointer-events-none disabled:cursor-not-allowed"
    >
      {pending ? 'Memeriksa...' : 'Masuk'}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialLoginState);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="username" className="text-sm font-medium">Username</label>
        <input
          id="username" name="username" type="text" required autoFocus
          className="w-full h-11 px-4 rounded-lg border border-input bg-background text-sm
            placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring
            transition-all duration-150"
          placeholder="Masukkan username"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <input
          id="password" name="password" type="password" required
          className="w-full h-11 px-4 rounded-lg border border-input bg-background text-sm
            placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring
            transition-all duration-150"
          placeholder="Masukkan password"
        />
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <SubmitButton />
    </form>
  );
}
