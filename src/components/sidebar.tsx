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
} from "lucide-react";
import { logoutAction } from "@/app/login/actions";

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    {
      section: "Utama",
      items: [
        { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      ],
    },
    {
      section: "Master",
      items: [
        { label: "Produk", href: "/dashboard/produk", icon: Package },
      ],
    },
    {
      section: "QC",
      items: [
        {
          label: "Inspeksi",
          href: "/dashboard/inspeksi",
          icon: ClipboardList,
        },
        { label: "COA", href: "/dashboard/coa", icon: FileText },
      ],
    },
    {
      section: "Dokumen",
      items: [
        {
          label: "Arsip",
          href: "/dashboard/arsip",
          icon: FileArchive,
        },
      ],
    },
    {
      section: "Pengaturan",
      items: [
        { label: "Logout", href: null, icon: LogOut },
      ],
    },
  ];

  function isActive(href: string | null) {
    if (!href) return false;
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <aside
      className="fixed left-0 top-0 h-full border-r bg-white flex flex-col"
      style={{ width: 238, borderColor: "#e5e9ef" }}
    >
      {/* Brand */}
      <div className="flex items-center h-[58px] px-5 border-b shrink-0" style={{ borderColor: "#e5e9ef" }}>
        <span className="text-base font-bold tracking-tight" style={{ color: "#047857" }}>
          INBIONUSA
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {navItems.map((group) => (
          <div key={group.section}>
            <div className="sidebar-section">{group.section}</div>
            {group.items.map((item) =>
              item.href ? (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`sidebar-link${isActive(item.href) ? " active" : ""}`}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              ) : (
                <form key={item.label} action={logoutAction}>
                  <button
                    type="submit"
                    className="sidebar-link w-full text-left"
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                </form>
              )
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
