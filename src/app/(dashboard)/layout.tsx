import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UserContextProvider } from "./user-context";
import { Topbar } from "@/components/topbar";

// Next 16 route segment config (cacheComponents): opt this segment out of
// instant-navigation validation so the blocking getSessionUser() redirect
// is allowed at build time. Without this, `next build` fails prerendering
// /dashboard with "uncached or runtime data during prerendering".
export const instant = false;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <UserContextProvider user={user}>
      <div className="min-h-screen bg-[var(--canvas)]">
        <Topbar />
        <main className="pt-[58px] p-6 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
    </UserContextProvider>
  );
}
