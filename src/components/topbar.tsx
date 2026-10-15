"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  FileText,
  FolderArchive,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/login/actions";
import { useUser } from "@/app/(dashboard)/user-context";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/produk", label: "Produk", icon: Package },
  { href: "/dashboard/inspeksi", label: "Inspeksi", icon: ClipboardList },
  { href: "/dashboard/coa", label: "COA", icon: FileText },
  { href: "/dashboard/arsip", label: "Arsip", icon: FolderArchive },
];

export function Topbar() {
  const { user } = useUser();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const avatarLetter = user?.nama_lengkap?.charAt(0).toUpperCase() ?? "?";

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [menuOpen]);

  const handleLogout = useCallback(() => {
    logoutAction();
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 h-[58px] bg-surface border-b border-border z-10 flex items-center justify-between px-6">
      {/* Left: logo + brand */}
      <div className="flex items-center gap-3">
        <img
          src="https://lh3.googleusercontent.com/d/1cTPhZUSGNhnud4LJyyuaA8Hc_ulDem-6"
          alt="INBIONUSA"
          className="h-7 w-auto"
        />
        <span className="text-primary font-bold text-base">INBIONUSA</span>
      </div>

      {/* Center: nav links */}
      <nav className="flex items-center gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-primary-soft text-primary-dark font-semibold"
                  : "text-muted hover:text-text hover:bg-chip-bg"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Right: avatar with custom popover */}
      <div className="relative">
        <button
          ref={btnRef}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-primary text-white text-sm font-bold select-none cursor-pointer hover:opacity-90 transition-opacity"
          aria-haspopup="true"
          aria-expanded={menuOpen}
        >
          {avatarLetter}
        </button>

        {menuOpen && (
          <div
            ref={menuRef}
            className="menu-pop absolute right-0 top-full mt-2 w-56 rounded-xl bg-surface border border-border shadow-card py-2 z-20"
          >
            {/* User info */}
            <div className="px-4 py-2">
              <p className="text-sm font-semibold text-text">
                {user?.nama_lengkap}
              </p>
              <p className="text-xs text-muted mt-0.5 capitalize">
                {user?.role}
              </p>
            </div>

            <div className="h-px bg-border mx-2 my-1" />

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-muted hover:text-text hover:bg-chip-bg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
