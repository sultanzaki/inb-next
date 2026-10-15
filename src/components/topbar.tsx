"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  FileText,
  FolderArchive,
  LogOut,
  Menu,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { logoutAction } from "@/app/login/actions";
import { useUser } from "@/app/(dashboard)/user-context";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
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

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logoutAction();
      setMenuOpen(false);
    } catch {
      toast.error("Gagal keluar. Coba lagi.");
    } finally {
      setLoggingOut(false);
    }
  }, []);

  const hideLogo = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = "none";
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-[58px] bg-surface border-b border-border z-10 flex items-center justify-between px-4 md:px-6">
      {/* Left: logo + brand */}
      <div className="flex items-center gap-3 min-w-0">
        <img
          src="/logo.png"
          alt="INBIONUSA"
          width={28}
          height={28}
          onError={hideLogo}
          className="h-7 w-7 object-contain"
        />
        <span className="text-primary font-bold text-base">INBIONUSA</span>
      </div>

      {/* Center: nav links (md+) */}
      <nav className="hidden md:flex items-center gap-1">
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

      {/* Right: hamburger (mobile) + avatar */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Buka menu navigasi"
          aria-expanded={sheetOpen}
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-text hover:bg-chip-bg transition-colors cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Avatar with custom popover */}
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
                disabled={loggingOut}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-muted hover:text-text hover:bg-chip-bg transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:text-muted disabled:hover:bg-transparent"
              >
                {loggingOut ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile nav sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-primary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="INBIONUSA"
                width={24}
                height={24}
                onError={hideLogo}
                className="h-6 w-6 object-contain"
              />
              INBIONUSA
            </SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 px-3 -mt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSheetOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
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
        </SheetContent>
      </Sheet>
    </header>
  );
}
