"use client";

import { useEffect, useState, ViewTransition, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  FileCheck2,
  FolderArchive,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  ChevronRight,
  ChevronsUpDown,
  LogOut,
  LifeBuoy,
  Keyboard,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useUser } from "@/app/(dashboard)/user-context";
import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

const navigation = [
  {
    href: "/dashboard",
    label: "Dashboard",
    description: "Ringkasan kinerja dan aktivitas mutu",
    icon: LayoutDashboard,
  },
  {
    href: "/dashboard/produk",
    label: "Produk",
    description: "Katalog produk dan spesifikasi pengujian",
    icon: Package,
  },
  {
    href: "/dashboard/inspeksi",
    label: "Inspeksi",
    description: "Pengujian, hasil, dan evaluasi lot",
    icon: ClipboardList,
  },
  {
    href: "/dashboard/coa",
    label: "COA",
    description: "Certificate of Analysis dan penerbitan",
    icon: FileCheck2,
  },
  {
    href: "/dashboard/arsip",
    label: "Arsip dokumen",
    description: "Dokumen mutu dan masa berlaku",
    icon: FolderArchive,
  },
];
const roles: Record<string, string> = {
  "admin qc": "Admin QC",
  "administrator inbionusa": "Administrator",
  "qc supervisor": "QC Supervisor",
  viewer: "Viewer",
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const current =
    navigation.find((item) => item.href === pathname) ?? navigation[0];
  useEffect(() => {
    document.title = `${current.label} — INBIONUSA`;
  }, [current.label]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setCollapsed(localStorage.getItem("inb-sidebar-collapsed") === "true");
      } catch {
        /* Storage may be unavailable. */
      }
    }, 0);
    function keyboard(event: KeyboardEvent) {
      if (
        document.querySelector('[role="dialog"]') &&
        !document.querySelector('[data-slot="command"]')
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === "Escape") setMobileOpen(false);
      if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement) &&
        !(event.target as HTMLElement).isContentEditable
      ) {
        const input = document.querySelector<HTMLInputElement>(
          "[data-search-input]",
        );
        if (input) {
          event.preventDefault();
          input.focus();
        }
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", keyboard);
    };
  }, []);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeMobile = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", closeMobile);
    return () => desktop.removeEventListener("change", closeMobile);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const side = document.getElementById("workspace-navigation");
    const previousFocus = document.activeElement as HTMLElement | null;
    side?.querySelector<HTMLAnchorElement>("a")?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab" || !side) return;
      const elements = Array.from(
        side.querySelectorAll<HTMLElement>("a,button"),
      ).filter((el) => el.getClientRects().length);
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", trap);
      previousFocus?.focus();
    };
  }, [mobileOpen]);
  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        localStorage.setItem("inb-sidebar-collapsed", String(!value));
      } catch {}
      return !value;
    });
  }
  async function logout() {
    setLoggingOut(true);
    try {
      await logoutAction();
    } catch {
      toast.error("Gagal keluar. Coba lagi.");
    } finally {
      setLoggingOut(false);
    }
  }
  function navigate(href: string) {
    setCommandOpen(false);
    setMobileOpen(false);
    router.push(href);
  }
  return (
    <div
      className="workspace"
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
    >
      <a href="#main-content" className="skip-link">
        Lewati ke konten utama
      </a>
      {mobileOpen && (
        <button
          className="workspace-scrim"
          aria-label="Tutup menu navigasi"
          onClick={() => setMobileOpen(false)}
          tabIndex={-1}
        />
      )}
      <aside
        id="workspace-navigation"
        className="workspace-sidebar"
        aria-label="Sidebar ruang kerja"
      >
        <Link
          href="/dashboard"
          className="workspace-brand"
          onClick={() => setMobileOpen(false)}
          aria-label="INBIONUSA — Dashboard"
        >
          <Image
            src="/logo.png"
            alt=""
            width={36}
            height={36}
            className="shrink-0 object-contain"
            priority
          />
          <div className="sidebar-label">
            <div className="workspace-brand-name">INBIONUSA</div>
            <div className="workspace-brand-caption">Quality Control</div>
          </div>
        </Link>
        <div className="mx-5 mb-4 h-px bg-border-soft" />
        <nav aria-label="Navigasi utama" className="workspace-nav">
          <p className="workspace-nav-label micro-label">Ruang kerja</p>
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              transitionTypes={["workspace-navigation"]}
              aria-current={pathname === href ? "page" : undefined}
              className="workspace-nav-link"
              title={collapsed ? label : undefined}
              onClick={() => setMobileOpen(false)}
            >
              <Icon className="workspace-nav-icon" />
              <span className="sidebar-label">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="workspace-sidebar-foot">
          <button className="sidebar-guide" onClick={() => setHelpOpen(true)}>
            <LifeBuoy className="size-4" />
            <span className="sidebar-label">Panduan & pintasan</span>
          </button>
          <div className="mb-3 h-px bg-border-soft" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  className="workspace-profile"
                  aria-label="Buka menu akun"
                />
              }
            >
              <span className="workspace-avatar">
                {user?.nama_lengkap?.charAt(0).toUpperCase() ?? "U"}
              </span>
              <span className="sidebar-label min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">
                  {user?.nama_lengkap}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted">
                  {roles[user?.role ?? "viewer"]}
                </span>
              </span>
              <ChevronsUpDown className="sidebar-label size-3.5 text-muted" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={10}
              className="min-w-56"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>Akun Anda</DropdownMenuLabel>
                <div className="px-3 py-2 text-xs text-muted">
                  @{user?.username}
                </div>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setHelpOpen(true)}>
                <LifeBuoy />
                Panduan & pintasan
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={loggingOut}
                onClick={() => void logout()}
              >
                {loggingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <div className="workspace-content" inert={mobileOpen || undefined}>
        <header className="workspace-header">
          <div className="flex min-w-0 items-center gap-4">
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden lg:inline-flex"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Perluas sidebar" : "Ringkas sidebar"}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="workspace-mobile-button"
              onClick={() => setMobileOpen(true)}
              aria-label="Buka menu navigasi"
              aria-expanded={mobileOpen}
            >
              <Menu />
            </Button>
            <div className="workspace-breadcrumb">
              <span className="hidden sm:inline">Ruang kerja</span>
              <ChevronRight className="hidden size-3 text-faint sm:block" />
              <strong>{current.label}</strong>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="workspace-search"
              onClick={() => setCommandOpen(true)}
              aria-label="Cari halaman, Ctrl K"
            >
              <Search className="size-4" />
              <span>Cari halaman…</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="h-5 w-px bg-border-soft" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Buka panduan"
              onClick={() => setHelpOpen(true)}
            >
              <LifeBuoy />
            </Button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="workspace-main">
          <ViewTransition name="workspace-content" default="workspace-page">
            <div key={pathname} className="surface-enter">
              {children}
            </div>
          </ViewTransition>
        </main>
      </div>
      <CommandDialog
        open={commandOpen}
        onOpenChange={setCommandOpen}
        title="Cari di ruang kerja"
        description="Temukan halaman dan navigasikan dengan keyboard."
      >
        <Command>
          <CommandInput
            placeholder="Ke mana Anda ingin pergi?"
            aria-label="Cari halaman"
          />
          <CommandList>
            <CommandEmpty>
              Halaman tidak ditemukan. Coba kata lain.
            </CommandEmpty>
            <CommandGroup heading="Navigasi ruang kerja">
              {navigation.map(({ href, label, description, icon: Icon }) => (
                <CommandItem
                  key={href}
                  value={`${label} ${description}`}
                  onSelect={() => navigate(href)}
                >
                  <span className="entity-icon">
                    <Icon className="size-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {description}
                    </span>
                  </span>
                  <CommandShortcut>↵</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-between border-t border-border-soft px-4 py-3 text-[10px] text-muted">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> untuk memilih
            </span>
            <span>
              <kbd>↵</kbd> buka <kbd>esc</kbd> tutup
            </span>
          </div>
        </Command>
      </CommandDialog>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <span className="entity-icon mb-3">
              <Keyboard className="size-5" />
            </span>
            <DialogTitle>Panduan ruang kerja</DialogTitle>
            <DialogDescription>
              Pintasan keyboard dan alur pengendalian mutu.
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 space-y-3">
            {[
              ["Cari halaman", "Ctrl / ⌘ + K"],
              ["Fokus ke pencarian daftar", "/"],
              ["Tutup dialog atau menu", "Escape"],
              ["Berpindah antar-field", "Tab"],
            ].map(([label, key]) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-xl border border-border-soft px-4 py-3 text-xs"
              >
                <span>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Produk menyimpan standar pengujian. Inspeksi mengevaluasi setiap
            lot. Hasil yang lulus dapat diterbitkan menjadi COA. Kelola dokumen
            pendukung di Arsip.
          </p>
          <Button className="mt-5 w-full" onClick={() => setHelpOpen(false)}>
            Mengerti
            <X className="size-3.5" />
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
