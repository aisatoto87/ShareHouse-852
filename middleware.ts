import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const cookies = request.cookies.getAll();
  const hasAuthTokenCookie = cookies.some((cookie) => cookie.name.includes("auth-token"));
  const hasAnyCookie = cookies.length > 0;

  if (!hasAuthTokenCookie && !hasAnyCookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/list-property/:path*",
    "/add-property/:path*",
    "/edit-property/:path*",
    "/admin/:path*",
  ],
};
