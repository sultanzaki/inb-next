import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UserContextProvider } from "./user-context";
import { Topbar } from "@/components/topbar";

/**
 * Next 16 (cacheComponents): akses runtime (cookies via getSessionUser)
 * harus berada di dalam <Suspense> agar route menghasilkan static shell dan
 * bagian dinamis di-stream — bukan `export const instant = false` (itu hanya
 * mematikan validasi, dan validasi versi dev tetap menggantungkan render).
 */
async function SessionGate({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <UserContextProvider user={user}>
      <div className="min-h-screen bg-[var(--canvas)]">
        <Topbar />
        <main className="pt-[58px] p-6 max-w-7xl mx-auto">{children}</main>
      </div>
    </UserContextProvider>
  );
}

/** Shell statis yang tampil selama sesi divalidasi (tanpa teks, tanpa data). */
function ShellFallback() {
  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <div className="h-[52px] border-b border-border bg-surface" />
      <div className="pt-[58px] p-6 max-w-7xl mx-auto space-y-4" aria-hidden />
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <SessionGate>{children}</SessionGate>
    </Suspense>
  );
}
