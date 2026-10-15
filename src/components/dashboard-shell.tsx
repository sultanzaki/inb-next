"use client";

import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { useSidebar } from "@/components/sidebar-context";

export function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { collapsed, sidebarWidth, collapsedWidth } = useSidebar();
  const marginLeft = collapsed ? collapsedWidth : sidebarWidth;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div
        className="flex-1 flex flex-col transition-all duration-300 ease-in-out"
        style={{ marginLeft }}
      >
        <Topbar title="Dashboard" />
        <main className="flex-1 overflow-y-auto pt-[58px] p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
