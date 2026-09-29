import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { env } from "@/lib/env";
import { signIn } from "@/lib/oidc";
import { SESSION_COOKIE, createSessionToken, sessionCookie } from "@/lib/session";
import { FLOW_COOKIE, FLOW_COOKIE_PATH, authPage, parseFlow } from "../flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const flow = parseFlow(req.cookies.get(FLOW_COOKIE)?.value);

  const error = params.get("error");
  if (error) {
    return authPage("Sign-in failed", `The identity provider said: ${params.get("error_description") ?? error}`, 400);
  }
  const code = params.get("code");
  if (!flow || !code || params.get("state") !== flow.state) {
    return authPage("Sign-in expired", "This sign-in link expired or was already used. Start again.", 400);
  }

  let email: string;
  try {
    email = await signIn(code, flow);
  } catch (err) {
    console.error("sign-in failed", err);
    return authPage("Sign-in failed", err instanceof Error ? err.message : String(err), 400);
  }

  // Only agents get a session; anyone else stops here rather than at every page.
  const [agent] = await db
    .select({ active: agents.active })
    .from(agents)
    .where(sql`lower(${agents.email}) = ${email}`)
    .limit(1);
  if (!agent?.active) {
    return authPage(
      "Not an agent here",
      `${email} isn't an active agent in this portal. Ask an admin to add you at Admin → Agents.`,
      403,
    );
  }

  const res = NextResponse.redirect(new URL(flow.next, env.appUrl));
  res.cookies.set(SESSION_COOKIE, await createSessionToken(email), sessionCookie());
  res.cookies.set(FLOW_COOKIE, "", { path: FLOW_COOKIE_PATH, maxAge: 0 });
  return res;
}
