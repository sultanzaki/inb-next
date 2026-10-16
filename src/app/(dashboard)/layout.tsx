import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UserContextProvider } from "./user-context";
import { AppShell } from "@/components/workspace/app-shell";

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
      <AppShell>{children}</AppShell>
    </UserContextProvider>
  );
}

/** Shell statis yang tampil selama sesi divalidasi (tanpa teks, tanpa data). */
function ShellFallback() {
  return (
    <div className="min-h-screen bg-page-bg" aria-label="Menyiapkan ruang kerja" role="status">
      <div className="hidden fixed inset-y-0 left-0 w-[244px] border-r border-border bg-surface lg:block" />
      <div className="lg:ml-[244px]"><div className="h-[72px] border-b border-border-soft bg-surface" /><div className="p-8"><div className="skeleton-shimmer h-7 w-48 rounded-lg" /><div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">{[0,1,2,3].map(i => <div key={i} className="skeleton-shimmer h-36 rounded-2xl" />)}</div></div></div>
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
