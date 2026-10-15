"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import { useUser } from "@/app/(dashboard)/user-context";
import { useSidebar } from "@/components/sidebar-context";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface TopbarProps {
  title: string;
}

export function Topbar({ title }: TopbarProps) {
  const { user } = useUser();
  const { collapsed, sidebarWidth, collapsedWidth } = useSidebar();
  const [isPending, startTransition] = useTransition();

  const avatarLetter = user?.nama_lengkap?.charAt(0).toUpperCase() ?? "?";

  return (
    <header
      className="fixed top-0 right-0 h-[58px] bg-white border-b flex items-center justify-between px-6 z-10 transition-all duration-300 ease-in-out"
      style={{
        left: collapsed ? collapsedWidth : sidebarWidth,
        borderColor: "#e5e9ef",
      }}
    >
      {/* Left: page title */}
      <h1 className="text-sm font-semibold">{title}</h1>

      {/* Right: avatar dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger className="cursor-pointer outline-none">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-full text-sm font-semibold select-none"
            style={{ background: "#047857", color: "#ffffff" }}
          >
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
