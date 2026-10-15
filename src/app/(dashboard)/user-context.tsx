"use client";

import { createContext, useContext, useMemo } from "react";
import type { User } from "@/lib/types";

interface UserCtx {
  user: User | null;
}

const UserContext = createContext<UserCtx>({ user: null });

export function UserContextProvider({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ user }), [user]);

  return (
    <UserContext.Provider value={value}>{children}</UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
