import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { calendarConsentUrl } from "@/lib/calendar";
import { CALENDAR_STATE_COOKIE, CALENDAR_STATE_PREFIX, safeNext } from "@/lib/calendar-oauth";
import { DATE_DETECTOR } from "@/lib/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start connecting the signed-in agent's Google Calendar. */
export async function GET(req: Request) {
  if (!DATE_DETECTOR) return new Response("Not found", { status: 404 });
  const { agent } = await requireAgent();
  const next = safeNext(new URL(req.url).searchParams.get("next"));

  // The prefix is how /api/admin/gmail/callback tells this consent from Gmail's.
  const state = CALENDAR_STATE_PREFIX + randomBytes(24).toString("base64url");
  (await cookies()).set(CALENDAR_STATE_COOKIE, JSON.stringify({ state, next }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  redirect(calendarConsentUrl(state, agent.email));
}
