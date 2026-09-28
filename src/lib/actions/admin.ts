"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { agentTeams, agents, tags, teams, gmailSync } from "@/db/schema";
import { requireAdmin, requireGmailOwner } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import { isTagColor } from "@/lib/tag-colors";
import { startWatch } from "@/lib/gmail/sync";
import { backfillBatch, backfillQuery, type BackfillBatch } from "@/lib/gmail/backfill";
import type { ActionState } from "./tickets";
import { recacheEveryone } from "@/lib/people";

export type { ActionState };

/* ---------------------------------------------------------------- agents */

export async function upsertAgent(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role") ?? "agent") as "agent" | "admin";

  if (!email.includes("@")) return { error: "A valid email is required" };
  if (!name) return { error: "A name is required" };

  if (id) {
    await db.update(agents).set({ email, name, role }).where(eq(agents.id, id));
  } else {
    await db
      .insert(agents)
      .values({ email, name, role })
      .onConflictDoNothing();
  }

  revalidatePath("/admin/agents");
  return { ok: id ? "Agent updated" : `Added ${name}` };
}

export async function setAgentActive(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const id = String(form.get("id"));
  const active = String(form.get("active")) === "true";
  await db.update(agents).set({ active }).where(eq(agents.id, id));
  revalidatePath("/admin/agents");
  return {
    ok: active
      ? "Reactivated"
      : "Deactivated — remember to remove them from the Cloudflare Access policy too",
  };
}

export async function setAgentTeam(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const agentId = String(form.get("agentId"));
  const teamId = String(form.get("teamId"));
  const on = String(form.get("on")) === "true";

  if (on) {
    await db.insert(agentTeams).values({ agentId, teamId }).onConflictDoNothing();
  } else {
    await db
      .delete(agentTeams)
      .where(and(eq(agentTeams.agentId, agentId), eq(agentTeams.teamId, teamId)));
  }

  revalidatePath("/admin/agents");
  return { ok: "Teams updated" };
}

/* ----------------------------------------------------------------- teams */

export async function createTeam(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "A name is required" };
  await db
    .insert(teams)
    .values({ name, slug: slugify(name) })
    .onConflictDoNothing();
  revalidatePath("/admin/teams");
  return { ok: `Created ${name}` };
}

export async function deleteTeam(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  await db.delete(teams).where(eq(teams.id, String(form.get("id"))));
  revalidatePath("/admin/teams");
  return { ok: "Team deleted" };
}

/* ------------------------------------------------------------------ tags */

/**
 * Create (no id) or update a tag. The slug is what ?tag= links use; it
 * defaults to one made from the name and must be unique.
 */
export async function saveTag(input: {
  id?: string;
  name: string;
  slug?: string;
  color: string;
}): Promise<ActionState> {
  await requireAdmin();
  const name = input.name.trim();
  const slug = slugify(input.slug?.trim() || name);
  if (!name) return { error: "A name is required" };
  if (!slug) return { error: "The slug needs at least one letter or number" };
  if (!isTagColor(input.color)) return { error: "Unknown colour" };

  const [clash] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.slug, slug), input.id ? ne(tags.id, input.id) : undefined))
    .limit(1);
  if (clash) return { error: `Another tag already uses the slug "${slug}"` };

  if (input.id) {
    const updated = await db
      .update(tags)
      .set({ name, slug, color: input.color })
      .where(eq(tags.id, input.id))
      .returning({ id: tags.id });
    if (!updated.length) return { error: "Tag not found" };
  } else {
    await db.insert(tags).values({ name, slug, color: input.color });
  }

  // Tag names, colours and slugs show in the sidebar and on every list.
  revalidatePath("/", "layout");
  return { ok: input.id ? `Saved ${name}` : `Created ${name}` };
}

export async function deleteTag(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  await db.delete(tags).where(eq(tags.id, String(form.get("id"))));
  revalidatePath("/", "layout");
  return { ok: "Tag deleted" };
}

/* ---------------------------------------------------------------- people */

/** Runs up to ~4 minutes; /admin/people sets maxDuration = 300. */
export async function recachePeople(): Promise<ActionState> {
  await requireAdmin();
  try {
    const r = await recacheEveryone();
    revalidatePath("/admin/people");
    revalidatePath("/tickets");
    const parts = [`Refreshed ${r.refreshed} of ${r.total}`];
    if (r.failed) parts.push(`${r.failed} failed`);
    if (r.remaining) parts.push(`${r.remaining} left, press again to continue`);
    return r.failed && !r.refreshed ? { error: parts.join(" · ") } : { ok: parts.join(" · ") };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/* ----------------------------------------------------------------- gmail */

export async function renewWatch(): Promise<ActionState> {
  await requireGmailOwner();
  try {
    const { expiration } = await startWatch();
    revalidatePath("/admin/gmail");
    return { ok: `Watch renewed, expires ${expiration.toLocaleString()}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runSyncNow(): Promise<ActionState> {
  await requireGmailOwner();
  const { syncFromHistory } = await import("@/lib/gmail/sync");
  try {
    const s = await syncFromHistory();
    revalidatePath("/admin/gmail");
    revalidatePath("/tickets");
    return {
      ok: `Scanned ${s.scanned}, ingested ${s.ingested}${s.fullResync ? " (full resync)" : ""}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * One batch of the /admin/gmail backfill. Runs for up to ~4 minutes (the page
 * sets maxDuration = 300); the client keeps calling until nothing remains.
 */
export async function runBackfillBatch(input: {
  query: string;
  after?: string;
}): Promise<BackfillBatch | { error: string }> {
  await requireGmailOwner();
  if (!input.query.trim()) return { error: "Enter a Gmail search" };
  try {
    const result = await backfillBatch(
      backfillQuery(input.query, input.after || undefined),
      240_000,
    );
    revalidatePath("/tickets");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function disconnectGmail(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireGmailOwner();
  await db.delete(gmailSync).where(eq(gmailSync.email, String(form.get("email"))));
  revalidatePath("/admin/gmail");
  return { ok: "Disconnected. Connect again to resume ingestion." };
}
