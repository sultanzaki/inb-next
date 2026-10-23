import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// session_token dibuat via crypto.randomUUID() -> UUID 36 karakter.
const SESSION_TOKEN_RE = /^[0-9a-f-]{36}$/i;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Halaman login & aset statis dilewati.
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/data/") ||
    pathname.startsWith("/api/erp/") ||
    pathname.startsWith("/api/operations/") ||
    pathname.startsWith("/api/operations-document/") ||
    pathname.startsWith("/api/operations-label/") ||
    pathname.startsWith("/api/dashboard/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Sesi wajib: cookie harus ada dan berbentuk UUID valid.
  // Cookie sampah / kedaluwarsa dianggap belum login.
  const token = request.cookies.get("session_token")?.value ?? "";

  if (!SESSION_TOKEN_RE.test(token)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.png|icon.png|apple-icon.png).*)",
  ],
};
