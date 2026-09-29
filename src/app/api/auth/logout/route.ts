import { NextResponse } from "next/server";
import { endSessionUrl } from "@/lib/oidc";
import { SESSION_COOKIE, sessionCookie, signInConfigured } from "@/lib/session";
import { authPage } from "../flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ends the app's session, then the identity provider's too when it publishes
 * an end-session endpoint. Otherwise the next visit would sign straight back in
 * without asking, so say so on a page of our own.
 */
export async function GET() {
  const end = signInConfigured() ? await endSessionUrl().catch(() => null) : null;
  const res = end
    ? NextResponse.redirect(end)
    : authPage("Signed out", "You're signed out of this portal.");
  res.cookies.set(SESSION_COOKIE, "", sessionCookie(0));
  return res;
}
