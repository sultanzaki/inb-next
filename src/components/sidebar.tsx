"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  FileText,
  FileArchive,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import { useSidebar } from "@/components/sidebar-context";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const LOGO_URL =
  "https://lh3.googleusercontent.com/d/1cTPhZUSGNhnud4LJyyuaA8Hc_ulDem-6";

const navGroups = [
  {
    section: "Utama",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    section: "Master",
    items: [{ label: "Produk", href: "/dashboard/produk", icon: Package }],
  },
  {
    section: "QC",
    items: [
      { label: "Inspeksi", href: "/dashboard/inspeksi", icon: ClipboardList },
      { label: "COA", href: "/dashboard/coa", icon: FileText },
    ],
  },
  {
    section: "Dokumen",
    items: [{ label: "Arsip", href: "/dashboard/arsip", icon: FileArchive }],
  },
  {
    section: "Pengaturan",
    items: [{ label: "Logout", href: null, icon: LogOut }],
  },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle, sidebarWidth, collapsedWidth } = useSidebar();

  const width = collapsed ? collapsedWidth : sidebarWidth;

  function isActive(href: string | null) {
    if (!href) return false;
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <aside
      className="fixed left-0 top-0 h-full border-r bg-white flex flex-col z-20 transition-all duration-300 ease-in-out"
      style={{ width, borderColor: "#e5e9ef" }}
    >
      {/* Logo + toggle row */}
      <div
        className="flex items-center h-[58px] shrink-0 transition-all duration-300 ease-in-out"
        style={{
          paddingLeft: collapsed ? 12 : 16,
          paddingRight: collapsed ? 8 : 12,
          borderBottom: "1px solid #e5e9ef",
          justifyContent: collapsed ? "center" : "space-between",
          gap: collapsed ? 0 : 8,
        }}
      >
        {/* Logo */}
        {collapsed ? (
          <img
            src={LOGO_URL}
            alt="INBIONUSA"
            className="size-7 rounded object-cover shrink-0"
          />
        ) : (
          <div className="flex items-center gap-2.5 overflow-hidden">
            <img
              src={LOGO_URL}
              alt="INBIONUSA"
              className="size-7 rounded object-cover shrink-0"
            />
            <span
              className="text-base font-bold tracking-tight whitespace-nowrap"
              style={{ color: "#047857" }}
            >
              INBIONUSA
            </span>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          className="shrink-0 flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-gray-100 active:bg-gray-200"
          style={{
            width: collapsed ? 36 : 28,
            height: collapsed ? 36 : 28,
            color: "#94a3b8",
          }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        {navGroups.map((group) => (
          <div key={group.section}>
            {/* Section label — hidden when collapsed */}
            {!collapsed && (
              <div
                className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-1.5 mt-3 first:mt-0"
                style={{ color: "#94a3b8" }}
              >
                {group.section}
              </div>
            )}

            {group.items.map((item) => {
              const active = isActive(item.href);

              const linkClasses =
                "flex items-center rounded-md transition-all duration-200 " +
                (active
                  ? "bg-emerald-50 text-emerald-700 font-semibold"
                  : "text-slate-600 hover:bg-emerald-50/60 hover:text-emerald-700");

              const iconSize = 18;

              const icon = (
                <item.icon
                  className="shrink-0 transition-transform duration-200"
                  size={iconSize}
                />
              );

              const content = (
                <>
                  {icon}
                  {!collapsed && (
                    <span className="text-sm whitespace-nowrap">
                      {item.label}
                    </span>
                  )}
                </>
              );

              // Logout is a form submit button
              if (!item.href) {
                return (
                  <form key={item.label} action={logoutAction}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger>
                          <button
                            type="submit"
                            className={linkClasses + " w-full text-left"}
                            style={{
                              padding: collapsed ? "10px" : "8px 12px",
                              justifyContent: collapsed ? "center" : "flex-start",
                              gap: collapsed ? 0 : 10,
                            }}
                          >
                            {content}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={10}>
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <button
                        type="submit"
                        className={linkClasses + " w-full text-left"}
                        style={{
                          padding: collapsed ? "10px" : "8px 12px",
                          justifyContent: collapsed ? "center" : "flex-start",
                          gap: collapsed ? 0 : 10,
                        }}
                      >
                        {content}
                      </button>
                    )}
                  </form>
                );
              }

              // Regular link item
              return (
                <div key={item.label}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger>
                        <Link
                          href={item.href}
                          className={linkClasses}
                          style={{
                            padding: collapsed ? "10px" : "8px 12px",
                            justifyContent: collapsed ? "center" : "flex-start",
                            gap: collapsed ? 0 : 10,
                          }}
                        >
                          {content}
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10}>
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Link
                      href={item.href}
                      className={linkClasses}
                      style={{
                        padding: collapsed ? "10px" : "8px 12px",
                        justifyContent: collapsed ? "center" : "flex-start",
                        gap: collapsed ? 0 : 10,
                      }}
                    >
                      {content}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
