"use client";
import {
  useEffect,
  useRef,
  useState,
  ViewTransition,
  type ReactNode,
} from "react";
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
  Menu,
  LogOut,
  Loader2,
  UserRound,
  KeyRound,
  Users,
  History,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { useUser } from "@/app/(dashboard)/user-context";
import { logoutAction } from "@/app/login/actions";
import { canAction } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/produk", label: "Produk", icon: Package },
  { href: "/dashboard/inspeksi", label: "Inspeksi", icon: ClipboardList },
  { href: "/dashboard/coa", label: "COA", icon: FileCheck2 },
  { href: "/dashboard/arsip", label: "Arsip", icon: FolderArchive },
  {
    href: "/dashboard/pengguna",
    label: "Pengguna",
    icon: Users,
    permission: "manage_users",
  },
  {
    href: "/dashboard/audit",
    label: "Audit",
    icon: History,
    permission: "read_audit",
  },
];
type SearchResult = {
  id: string;
  type: string;
  title: string;
  description: string;
  href: string;
};
export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useUser(),
    pathname = usePathname(),
    router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false),
    [commandOpen, setCommandOpen] = useState(false),
    [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState(false),
    [retry, setRetry] = useState(0),
    [loggingOut, setLoggingOut] = useState(false);
  const seq = useRef(0);
  const items = navigation.filter(
    (n) => !n.permission || canAction(user?.role || "viewer", n.permission),
  );
  const current = items.find((n) => n.href === pathname);
  useEffect(() => {
    document.title = `${current?.label || "INBIONUSA"} — INBIONUSA`;
  }, [current?.label]);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if (
        document.querySelector('[role="dialog"]') &&
        !document.querySelector('[data-slot="command"]')
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement) &&
        !(e.target as HTMLElement).isContentEditable
      ) {
        const input = document.querySelector<HTMLInputElement>(
          "[data-search-input]",
        );
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, []);
  useEffect(() => {
    const id = ++seq.current,
      controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!commandOpen || query.trim().length < 2) {
        setResults([]);
        setSearching(false);
        setSearchError(false);
        return;
      }
      setSearching(true);
      setSearchError(false);
      try {
        const r = await fetch(
          "/api/search?q=" + encodeURIComponent(query.trim()),
          { signal: controller.signal },
        );
        if (!r.ok) throw Error();
        const data = await r.json();
        if (id === seq.current) setResults(data.results);
      } catch {
        if (!controller.signal.aborted && id === seq.current) {
          setSearchError(true);
          setResults([]);
        }
      } finally {
        if (id === seq.current) setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, commandOpen, retry]);
  function navigate(href: string) {
    setMobileOpen(false);
    setCommandOpen(false);
    setQuery("");
    const target = new URL(href, window.location.origin);
    if (target.pathname === pathname && target.searchParams.has("q")) {
      router.replace(href);
      window.dispatchEvent(
        new CustomEvent("workspace:query", {
          detail: target.searchParams.get("q") || "",
        }),
      );
    } else router.push(href);
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
  const shownNavigation = items.filter((n) =>
    n.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="application">
      <a href="#main-content" className="skip-link">
        Lewati ke konten utama
      </a>
      <header className="app-topbar">
        <div className="app-topbar-inner">
          <Link
            href="/dashboard"
            className="app-wordmark"
            aria-label="INBIONUSA — Dashboard"
          >
            <Image src="/logo.png" alt="" width={34} height={34} priority />
            <span>INBIONUSA</span>
          </Link>
          <nav className="app-desktop-nav" aria-label="Navigasi utama">
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={pathname === n.href ? "page" : undefined}
                transitionTypes={["workspace-navigation"]}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="app-topbar-actions">
            <button
              className="app-global-search"
              aria-label="Cari lot, produk, COA, atau halaman"
              onClick={() => setCommandOpen(true)}
            >
              <Search className="size-4" />
              <span>Cari…</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    className="app-account-button"
                    aria-label="Buka menu akun"
                  />
                }
              >
                <UserRound className="size-4" />
                <span>{user?.nama_lengkap?.split(" ")[0]}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold">{user?.nama_lengkap}</p>
                  <p className="mt-1 text-[11px] text-muted">
                    {user?.role} · @{user?.username}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => router.push("/account/password")}
                >
                  <KeyRound />
                  Ganti password
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={loggingOut}
                  onClick={() => void logout()}
                >
                  {loggingOut ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <LogOut />
                  )}
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              className="app-mobile-nav-toggle"
              variant="ghost"
              size="icon-sm"
              aria-label="Buka menu navigasi"
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>
          </div>
        </div>
      </header>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="top" className="app-mobile-menu">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>INBIONUSA · Quality Control</SheetDescription>
          </SheetHeader>
          <nav aria-label="Navigasi utama">
            {items.map(({ icon: Icon, ...n }) => (
              <Link
                href={n.href}
                key={n.href}
                aria-current={pathname === n.href ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <Icon className="size-4" />
                {n.label}
                <ArrowUpRight className="ml-auto size-3.5" />
              </Link>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
      <main id="main-content" tabIndex={-1} className="workspace-main app-main">
        <ViewTransition name="workspace-content" default="workspace-page">
          <div key={pathname} className="surface-enter">
            {children}
          </div>
        </ViewTransition>
      </main>
      <CommandDialog
        open={commandOpen}
        onOpenChange={(v) => {
          setCommandOpen(v);
          if (!v) setQuery("");
        }}
        title="Cari di INBIONUSA"
        description="Temukan lot, produk, sertifikat, atau halaman."
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setResults([]);
              setSearchError(false);
            }}
            placeholder="Cari lot, produk, atau COA…"
            aria-label="Pencarian lintas modul"
          />
          <CommandList>
            {shownNavigation.length > 0 && (
              <CommandGroup heading="Halaman">
                {shownNavigation.map(({ icon: Icon, ...n }) => (
                  <CommandItem
                    key={n.href}
                    value={n.href}
                    onSelect={() => navigate(n.href)}
                  >
                    <Icon className="size-4 text-muted" />
                    <span>{n.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.length > 0 && (
              <CommandGroup heading="Hasil pencarian">
                {results.map((r) => (
                  <CommandItem
                    key={r.type + r.id}
                    value={r.type + r.id}
                    onSelect={() => navigate(r.href)}
                  >
                    <span className="search-result-type">{r.type}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{r.title}</span>
                      <span className="mt-1 block truncate text-xs text-muted">
                        {r.description}
                      </span>
                    </span>
                    <ArrowUpRight className="ml-auto size-3.5" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {searching && (
              <p role="status" className="px-4 py-5 text-xs text-muted">
                Mencari data…
              </p>
            )}
            {searchError && (
              <div role="alert" className="px-4 py-4 text-xs text-danger">
                Pencarian belum berhasil.
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRetry((v) => v + 1)}
                >
                  Coba lagi
                </Button>
              </div>
            )}
            {!searching &&
              !searchError &&
              query.length >= 2 &&
              results.length === 0 &&
              shownNavigation.length === 0 && (
                <CommandEmpty>Tidak ada hasil yang cocok.</CommandEmpty>
              )}
            {query.length < 2 && (
              <p className="px-4 py-4 text-xs text-muted">
                Ketik minimal 2 karakter untuk mencari data.
              </p>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}
