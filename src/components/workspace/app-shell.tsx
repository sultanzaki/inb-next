"use client";
import { roleLabel } from "@/lib/rbac";
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  ViewTransition,
  type ReactNode,
} from "react";
import { ThemeControl } from "@/components/theme/theme-control";
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
  LogOut,
  Loader2,
  KeyRound,
  Users,
  History,
  ArrowUpRight,
  PanelLeftClose,
  PanelLeftOpen,
  Grid2X2,
} from "lucide-react";
import { useUser } from "@/app/(dashboard)/user-context";
import { useLogout } from "@/hooks/use-logout";
import { useERP } from "@/components/erp/context";
import { Factory, Warehouse, Handshake, Settings2 } from "lucide-react";
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
import { MobileConsoleNavigation } from "./mobile-console-navigation";
import { WorkspaceSidebar } from "./workspace-navigation";
const navigation = [
  { href: "/dashboard/workspaces", label: "Work", icon: Grid2X2 },
  { href: "/dashboard/inbox", label: "Inbox", icon: ClipboardList },
  {
    href: "/dashboard/quality",
    label: "Quality analytics",
    icon: LayoutDashboard,
  },
  { href: "/dashboard/purchase", label: "Purchase", icon: Package },
  { href: "/dashboard/crm", label: "CRM", icon: Users },
  {
    href: "/dashboard/product-documents",
    label: "Product documents",
    icon: FolderArchive,
  },
  {
    href: "/dashboard/warehouse/materials",
    label: "Raw materials",
    icon: Package,
  },
  { href: "/dashboard/warehouse", label: "Warehouse", icon: Warehouse },
  { href: "/dashboard/production", label: "Production", icon: Factory },
  { href: "/dashboard/sales", label: "Sales", icon: Handshake },
  {
    href: "/dashboard/admin/settings",
    label: "Settings",
    icon: Settings2,
    permission: "manage_users",
  },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/master-data/products", label: "Products", icon: Package },
  {
    href: "/dashboard/quality/inspections",
    label: "Inspections",
    icon: ClipboardList,
  },
  { href: "/dashboard/quality/certificates", label: "COA", icon: FileCheck2 },
  {
    href: "/dashboard/admin/users",
    label: "Users",
    icon: Users,
    permission: "manage_users",
  },
  {
    href: "/dashboard/admin/audit-log",
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
export function AppShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  const erp = useERP();
  const { user } = useUser(),
    pathname = usePathname(),
    router = useRouter();
  const [collapsed, setCollapsed] = useState(false),
    [commandOpen, setCommandOpen] = useState(false),
    [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState(false),
    [retry, setRetry] = useState(0);
  const { logout, loggingOut } = useLogout();
  const seq = useRef(0);
  useEffect(() => {
    const t = setTimeout(
      () =>
        setCollapsed(
          localStorage.getItem("inb-sidebar") === null
            ? window.matchMedia("(max-width:1099px)").matches
            : localStorage.getItem("inb-sidebar") === "true",
        ),
      0,
    );
    return () => clearTimeout(t);
  }, []);
  const items = navigation.filter((n) => {
    if (n.permission && !canAction(user || "viewer", n.permission))
      return false;
    if (n.href.endsWith("/purchase")) return erp.can("purchase");
    if (n.href.endsWith("/crm")) return erp.can("crm");
    if (n.href.endsWith("/documents")) return erp.can("documents");
    if (n.href.endsWith("/materials")) return erp.can("warehouse");
    if (n.href.endsWith("/warehouse")) return erp.can("warehouse");
    if (n.href.endsWith("/production")) return erp.can("production");
    if (n.href.endsWith("/sales")) return erp.can("sales");
    if (
      [
        "/dashboard/quality/inspections",
        "/dashboard/quality/certificates",
        "/dashboard/quality",
      ].includes(n.href)
    )
      return erp.can("quality");
    return true;
  });
  const current = items.find((n) => n.href === pathname);
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
  const shownNavigation = items.filter((n) =>
    n.label.toLowerCase().includes(query.toLowerCase()),
  );
  const initials = (user?.nama_lengkap || user?.username || "IN")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const accountMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            className="app-account-button"
            aria-label="Open account menu"
          />
        }
      >
        <span className="account-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="account-trigger-name">
          {user?.nama_lengkap?.split(" ")[0]}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <div className="account-identity">
          <span
            className="account-avatar account-avatar-large"
            aria-hidden="true"
          >
            {initials}
          </span>
          <div>
            <p className="account-full-name">{user?.nama_lengkap}</p>
            <p className="account-handle">@{user?.username}</p>
            <span className="account-role">
              {roleLabel(user?.role || "viewer")}
            </span>
          </div>
        </div>
        <ThemeControl compact />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/account/password")}>
          <KeyRound />
          Change password
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={loggingOut}
          onClick={() => void logout()}
        >
          {loggingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <div
      className={
        "application release-shell" + (collapsed ? " sidebar-collapsed" : "")
      }
    >
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside className="workspace-sidebar">
        <Link href="/dashboard" className="sidebar-brand">
          <Image src="/logo.png" alt="INBIONUSA" width={32} height={32} />
          <span>INBIONUSA</span>
        </Link>
        <Suspense fallback={<p className="sr-only">Loading navigation…</p>}>
          <WorkspaceSidebar collapsed={collapsed} />
        </Suspense>
      </aside>
      <Suspense fallback={<div className="mobile-console-placeholder" />}>
        <MobileConsoleNavigation
          onSearch={() => setCommandOpen(true)}
          account={accountMenu}
        />
      </Suspense>
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
          <button
            className="sidebar-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => {
              setCollapsed(!collapsed);
              localStorage.setItem("inb-sidebar", String(!collapsed));
            }}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
          <span className="workspace-current">
            {current?.label || "Workspace"}
          </span>
          <div className="app-topbar-actions">
            <button
              className="app-global-search"
              aria-label="Search lots, products, COAs, or pages"
              onClick={() => setCommandOpen(true)}
            >
              <Search className="size-4" />
              <span>Search…</span>
            </button>
            {accountMenu}
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="workspace-main app-main">
        <ViewTransition name="workspace-content" default="workspace-page">
          <div key={pathname} className="surface-enter">
            {children}
          </div>
        </ViewTransition>
        <footer className="workspace-copyright">{footer}</footer>
      </main>
      <CommandDialog
        open={commandOpen}
        onOpenChange={(v) => {
          setCommandOpen(v);
          if (!v) setQuery("");
        }}
        title="Search INBIONUSA"
        description="Find lots, products, certificates, orders, or pages."
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setResults([]);
              setSearchError(false);
            }}
            placeholder="Search lots, products, or COAs…"
            aria-label="Search all modules"
          />
          <CommandList>
            {shownNavigation.length > 0 && (
              <CommandGroup heading="Pages">
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
              <CommandGroup heading="Search results">
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
                Searching…
              </p>
            )}
            {searchError && (
              <div role="alert" className="px-4 py-4 text-xs text-danger">
                Search failed.
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRetry((v) => v + 1)}
                >
                  Retry
                </Button>
              </div>
            )}
            {!searching &&
              !searchError &&
              query.length >= 2 &&
              results.length === 0 &&
              shownNavigation.length === 0 && (
                <CommandEmpty>No matching results.</CommandEmpty>
              )}
            {query.length < 2 && (
              <p className="px-4 py-4 text-xs text-muted">
                Type at least 2 characters to search.
              </p>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}
