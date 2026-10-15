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
    <header className="fixed top-0 left-0 right-0 z-10 flex h-[52px] items-center bg-surface border-b border-border px-4 md:px-6">
      {/* Left: logo + stacked brand lockup */}
      <div className="flex shrink-0 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="INBIONUSA"
          width={24}
          height={24}
          onError={hideLogo}
          className="h-6 w-6 rounded-[4px] object-contain"
        />
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-primary">
            INBIONUSA
          </span>
          <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            QC System
          </span>
        </div>
      </div>

      {/* Center-left: nav links (md+) */}
      <nav
        aria-label="Navigasi utama"
        className="ml-8 hidden h-full items-stretch gap-1 md:flex"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex h-full items-center gap-1.5 px-3 text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 ${
                isActive
                  ? "font-medium text-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-[2px] rounded-t bg-primary"
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Right: hamburger (mobile) + avatar */}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Buka menu navigasi"
          aria-expanded={sheetOpen}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[6px] text-muted transition-colors duration-150 hover:bg-chip-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Avatar with custom popover */}
        <div className="relative">
          <button
            ref={btnRef}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 cursor-pointer select-none items-center justify-center rounded-full bg-primary text-sm font-bold text-white transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            {avatarLetter}
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              className="menu-pop absolute right-0 top-full mt-2 w-56 rounded-[8px] border border-border bg-surface py-2 z-20"
            >
              {/* User info */}
              <div className="px-4 py-2">
                <p className="text-sm font-semibold text-text">
                  {user?.nama_lengkap}
                </p>
                <p className="mt-0.5 text-xs capitalize text-muted">
                  {user?.role}
                </p>
              </div>

              <div className="mx-2 my-1 h-px bg-border" />

              {/* Logout */}
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:bg-chip-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-muted"
              >
                {loggingOut ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
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
                className="h-6 w-6 rounded-[4px] object-contain"
              />
              INBIONUSA
            </SheetTitle>
          </SheetHeader>
          <nav aria-label="Navigasi utama" className="-mt-2 flex flex-col gap-1 px-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSheetOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex min-h-[48px] items-center gap-2.5 rounded-[6px] px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 ${
                    isActive
                      ? "bg-primary-soft font-semibold text-primary-dark"
                      : "text-muted hover:bg-chip-bg hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
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
