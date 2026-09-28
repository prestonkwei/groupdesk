"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, savedViews } from "@/db/schema";
import { requireAgent } from "@/lib/auth";
import type { ActionState } from "./tickets";

/** Save the current list filters (a /tickets query string) under a name. */
export async function saveView(name: string, query: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  const clean = name.trim().slice(0, 60);
  if (!clean) return { error: "Name the view" };
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(savedViews)
    .where(eq(savedViews.agentId, agent.id));
  if (n >= 30) return { error: "That's 30 views: delete one first" };
  await db.insert(savedViews).values({ agentId: agent.id, name: clean, query, position: n });
  revalidatePath("/", "layout");
  return { ok: `Saved “${clean}”` };
}

export async function deleteView(id: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.agentId, agent.id)));
  revalidatePath("/", "layout");
  return { ok: "View deleted" };
}

/** Turn my assignment / reply / mention emails on or off. */
export async function setNotifyEmail(on: boolean): Promise<ActionState> {
  const { agent } = await requireAgent();
  await db.update(agents).set({ notifyEmail: on }).where(eq(agents.id, agent.id));
  revalidatePath("/", "layout");
  return { ok: on ? "Notifications on" : "Notifications off" };
}
