import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SidebarProvider } from "@/components/sidebar-context";
import { DashboardShell } from "@/components/dashboard-shell";

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
    <SidebarProvider>
      <DashboardShell>{children}</DashboardShell>
    </SidebarProvider>
  );
}
