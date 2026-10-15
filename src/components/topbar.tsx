"use client";

import { logoutAction } from "@/app/login/actions";
import type { User } from "@/lib/types";

interface TopbarProps {
  title: string;
  user: User;
}

export function Topbar({ title, user }: TopbarProps) {
  return (
    <header
      className="fixed top-0 left-[238px] right-0 h-[58px] bg-white border-b flex items-center justify-between px-6 z-10"
      style={{ borderColor: "#e5e9ef" }}
    >
      {/* Left: page title */}
      <h1 className="text-sm font-semibold">{title}</h1>

      {/* Right: user info + logout */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium" style={{ color: "#334155" }}>
          {user.nama_lengkap}
        </span>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
          style={{
            background: "#ecfdf5",
            color: "#047857",
          }}
        >
          {user.role}
        </span>
        <form action={logoutAction}>
          <button
            type="submit"
            className="text-xs font-medium px-3 py-1.5 rounded transition-colors"
            style={{
              color: "#64748b",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "#fef2f2";
              e.currentTarget.style.color = "#b91c1c";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "#64748b";
            }}
          >
            Logout
          </button>
        </form>
      </div>
    </header>
  );
}
