import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorizationUrl } from "@/lib/oidc";
import { signInConfigured } from "@/lib/session";
import { FLOW_COOKIE, FLOW_COOKIE_PATH, authPage, safeNext, type Flow } from "../flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!signInConfigured()) {
    return authPage("Sign-in isn't set up", "Set OIDC_ISSUER and OIDC_CLIENT_ID.", 503);
  }

  const flow: Flow = {
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    next: safeNext(req.nextUrl.searchParams.get("next")),
  };

  let url: URL;
  try {
    url = await authorizationUrl(flow);
  } catch (err) {
    console.error("sign-in could not start", err);
    return authPage("Sign-in is unavailable", "The identity provider couldn't be reached.", 502);
  }

  const res = NextResponse.redirect(url);
  res.cookies.set(FLOW_COOKIE, JSON.stringify(flow), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: FLOW_COOKIE_PATH,
    maxAge: 600,
  });
  return res;
}
