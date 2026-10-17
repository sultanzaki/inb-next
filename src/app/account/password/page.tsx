import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { PasswordForm } from "./password-form";
async function Content() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <PasswordForm
      forced={Boolean(user.must_change_password)}
      username={user.username}
    />
  );
}
export default function PasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="password-page" role="status">
          Memuat akun…
        </main>
      }
    >
      <Content />
    </Suspense>
  );
}
