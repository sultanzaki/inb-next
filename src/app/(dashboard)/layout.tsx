import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { UserContextProvider } from "./user-context";

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
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 flex flex-col" style={{ marginLeft: 238 }}>
          <Topbar title="Dashboard" user={user} />
          <main className="flex-1 overflow-y-auto pt-[58px] p-6">
            {children}
          </main>
        </div>
      </div>
    </UserContextProvider>
  );
}
