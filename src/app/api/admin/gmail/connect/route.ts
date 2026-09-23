import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { consentUrl } from "@/lib/gmail/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "gmail_oauth_state";

export async function GET() {
  await requireAdmin();

  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  redirect(consentUrl(state));
}
