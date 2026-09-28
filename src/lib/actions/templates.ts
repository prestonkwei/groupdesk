"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { templates } from "@/db/schema";
import { requireAgent } from "@/lib/auth";
import type { ActionState } from "./tickets";

/** Anyone on the team can add to or edit the shared library. */
export async function saveTemplate(input: {
  id?: string;
  name: string;
  bodyHtml: string;
}): Promise<ActionState & { id?: string }> {
  const { agent } = await requireAgent();
  const name = input.name.trim();
  const bodyHtml = input.bodyHtml.trim();
  if (!name) return { error: "Give the template a name" };
  if (!bodyHtml || bodyHtml === "<p></p>") return { error: "The template is empty" };

  let id = input.id;
  if (id) {
    const updated = await db
      .update(templates)
      .set({ name, bodyHtml, updatedBy: agent.id, updatedAt: new Date() })
      .where(eq(templates.id, id))
      .returning({ id: templates.id });
    if (!updated.length) return { error: "Template not found" };
  } else {
    const [row] = await db
      .insert(templates)
      .values({ name, bodyHtml, createdBy: agent.id, updatedBy: agent.id })
      .returning({ id: templates.id });
    id = row.id;
  }

  revalidatePath("/templates");
  return { ok: input.id ? `Saved “${name}”` : `Created “${name}”`, id };
}

export async function deleteTemplate(id: string): Promise<ActionState> {
  await requireAgent();
  await db.delete(templates).where(eq(templates.id, id));
  revalidatePath("/templates");
  return { ok: "Template deleted" };
}
