import { NextResponse, type NextRequest } from "next/server";
import { readAccessToken, verifyAccessToken } from "@/lib/access-jwt";

/**
 * Routes that authenticate themselves and must not be gated on an Access JWT:
 *   /api/gmail/push  -> Pub/Sub OIDC token
 *   /api/cron/*      -> CRON_SECRET (or Vercel's cron header)
 *   /csat/*          -> the survey token in the URL (requesters aren't agents)
 * Cloudflare Access needs matching Bypass policies; this is the app-side half,
 * so the *.vercel.app URL behaves the same way. (Next 16 calls this file `proxy`.)
 */
const SELF_AUTHENTICATED = [/^\/api\/gmail\/push$/, /^\/api\/cron\//, /^\/csat\//];

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (SELF_AUTHENTICATED.some((re) => re.test(pathname))) {
    return NextResponse.next();
  }

  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
  const aud = process.env.CF_ACCESS_AUD;

  // Not configured yet (local dev, or before Access is wired up).
  if (!teamDomain || !aud) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Access is not configured", { status: 503 });
    }
    return NextResponse.next();
  }

  const token = readAccessToken(req);
  if (!token) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const identity = await verifyAccessToken(token, { teamDomain, aud });
  if (!identity) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.next();
}
