import { ERPModuleGuard } from "./shared";
import Link from "next/link";
import { moduleGate } from "@/lib/erp/server";
import type { ReactNode } from "react";
export async function QualityGate({ children }: { children: ReactNode }) {
  const denied = await moduleGate("quality");
  return denied ? (
    <div className="erp-empty">
      <h1>Quality module unavailable</h1>
      <p>This module is disabled or your account does not have access.</p>
      <Link href="/dashboard">Return to overview</Link>
    </div>
  ) : (
    <ERPModuleGuard module="quality">{children}</ERPModuleGuard>
  );
}
