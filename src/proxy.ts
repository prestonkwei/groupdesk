import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { SESSION_COOKIE, readSessionToken, signInConfigured } from "@/lib/session";

/**
 * Routes that must not require a signed-in agent:
 *   /api/auth/*      -> the sign-in flow itself
 *   /api/gmail/push  -> Pub/Sub OIDC token
 *   /api/cron/*      -> CRON_SECRET (or Vercel's cron header)
 *   /csat/*          -> the survey token in the URL (requesters aren't agents)
 * (Next 16 calls this file `proxy`.)
 */
const PUBLIC = [/^\/api\/auth\//, /^\/api\/gmail\/push$/, /^\/api\/cron\//, /^\/csat\//];

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) {
    return NextResponse.next();
  }

  // Not configured yet: local dev runs as DEV_BYPASS_EMAIL; production refuses.
  if (!signInConfigured()) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Sign-in is not configured", { status: 503 });
    }
    return NextResponse.next();
  }

  if (await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // Page loads go to the identity provider; fetches and server actions get a 401.
  if (req.method === "GET" && !pathname.startsWith("/api/")) {
    const login = new URL("/api/auth/login", env.appUrl);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  return new NextResponse("Unauthorized", { status: 401 });
}
