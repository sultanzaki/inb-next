"use client";

import { createContext, useContext } from "react";
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
  return (
    <UserContext.Provider value={{ user }}>{children}</UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
