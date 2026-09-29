import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, agentTeams, type Agent } from "@/db/schema";
import { env } from "./env";
import { SESSION_COOKIE, readSessionToken } from "./session";

export type Session = { agent: Agent; teamIds: string[] };

async function identityEmail(): Promise<string | null> {
  const email = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (email) return email;
  return env.devBypassEmail ? env.devBypassEmail.toLowerCase() : null;
}

/** Cached per request: the signed-in agent, or null. */
export const getSession = cache(async (): Promise<Session | null> => {
  const email = await identityEmail();
  if (!email) return null;

  const [agent] = await db
    .select()
    .from(agents)
    .where(sql`lower(${agents.email}) = ${email}`)
    .limit(1);

  if (!agent || !agent.active) return null;

  const teams = await db
    .select({ teamId: agentTeams.teamId })
    .from(agentTeams)
    .where(eq(agentTeams.agentId, agent.id));

  return { agent, teamIds: teams.map((t) => t.teamId) };
});

export async function requireAgent(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new Error(
      "Not authorized. You're signed in, but not as an active agent in this portal.",
    );
  }
  return session;
}

/** The Gmail connection belongs to one person: the owner of GMAIL_MAILBOX. */
export function canManageGmail(agent: Agent): boolean {
  return agent.role === "admin" && agent.email.toLowerCase() === env.gmailMailbox;
}

export async function requireGmailOwner(): Promise<Session> {
  const session = await requireAgent();
  if (!canManageGmail(session.agent)) {
    throw new Error(`Only ${env.gmailMailbox} can manage the Gmail connection.`);
  }
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireAgent();
  if (session.agent.role !== "admin") {
    throw new Error("Admins only.");
  }
  return session;
}
