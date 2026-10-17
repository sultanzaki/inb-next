"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter, unstable_rethrow } from "next/navigation";
import { logoutAction } from "@/app/login/actions";

export function useLogout() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false),
    pending = useRef(false);
  async function logout() {
    if (pending.current) return;
    toast.dismiss("workspace-signout");
    pending.current = true;
    setLoggingOut(true);
    try {
      const result = await logoutAction();
      if (!result.ok) throw new Error("revoke_failed");
      // Cookie deletion invalidates authenticated router data.
      router.replace("/login");
      router.refresh();
    } catch (error) {
      unstable_rethrow(error);
      pending.current = false;
      setLoggingOut(false);
      toast.error("Could not sign out. Retry.", {
        id: "workspace-signout",
        position: "bottom-right",
        duration: Infinity,
        action: { label: "Retry", onClick: () => void logout() },
      });
    }
  }
  return { logout, loggingOut };
}
