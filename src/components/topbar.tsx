"use client";

import { useTransition } from "react";
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

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
  const [isPending, startTransition] = useTransition();

  const avatarLetter = user?.nama_lengkap?.charAt(0).toUpperCase() ?? "?";

  return (
    <header className="fixed top-0 left-0 right-0 h-[58px] bg-white border-b z-10 flex items-center justify-between px-6">
      {/* Left: logo + brand */}
      <div className="flex items-center gap-3">
        <img
          src="https://lh3.googleusercontent.com/d/1cTPhZUSGNhnud4LJyyuaA8Hc_ulDem-6"
          alt="INBIONUSA"
          className="h-8 w-auto"
        />
        <span className="text-lg font-bold" style={{ color: "#047857" }}>
          INBIONUSA
        </span>
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
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-emerald-50 text-emerald-700 font-semibold"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Right: avatar dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger className="cursor-pointer outline-none">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-600 text-white text-sm font-semibold select-none">
            {avatarLetter}
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8}>
          <DropdownMenuLabel className="font-normal">
            <div className="font-semibold text-sm">{user?.nama_lengkap}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {user?.role}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={isPending}
            onClick={() => startTransition(() => logoutAction())}
          >
            <LogOut className="w-4 h-4" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
