import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events, tags, ticketTags } from "@/db/schema";
import { rosterPerson } from "@/lib/roster";
import { VIP_TAG } from "@/lib/vip-tag";

async function vipTagId() {
  await db.insert(tags).values(VIP_TAG).onConflictDoNothing({ target: tags.slug });
  const [tag] = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.slug, VIP_TAG.slug))
    .limit(1);
  return tag;
}

/**
 * Tag a new ticket VIP when Roster says the requester is faculty. Never throws:
 * a lookup that fails should not fail ingestion, and the tag can be added by hand.
 */
export async function flagVipIfFaculty(ticketId: string, requesterEmail: string) {
  try {
    const person = await rosterPerson(requesterEmail);
    if (person?.gradYear !== "faculty") return;

    const tag = await vipTagId();
    const [added] = await db
      .insert(ticketTags)
      .values({ ticketId, tagId: tag.id })
      .onConflictDoNothing()
      .returning({ tagId: ticketTags.tagId });
    if (!added) return;

    await db.insert(events).values({
      ticketId,
      kind: "tag_added",
      data: { tagName: tag.name, auto: "faculty" },
    });
  } catch (err) {
    console.error("VIP check failed", err);
  }
}
