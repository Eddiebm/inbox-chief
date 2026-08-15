import { NextResponse, type NextRequest } from "next/server";
import {
  isAcceptableSessionCookie,
  SESSION_COOKIE,
} from "@/lib/session-cookie";

/**
 * Edge middleware kept for Cloudflare OpenNext compatibility.
 * Next.js 16 prefers `proxy.ts` (Node), but OpenNext currently requires Edge middleware.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsAuth =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  if (!needsAuth) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (isAcceptableSessionCookie(token)) {
    return NextResponse.next();
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  const response = NextResponse.redirect(login);
  // Drop stale mock sessions once real auth/DB is enabled.
  if (token?.startsWith("mock.") && process.env.MOCK_INTEGRATIONS !== "true") {
    response.cookies.delete(SESSION_COOKIE);
  }
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
