import "server-only";
import { after } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { env } from "@/lib/env";
import { googleAuthFor } from "@/lib/gmail/client";

/** How long a looked-up photo (or "no photo") is trusted before asking again. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** Lookups per request, so a long ticket list can't burn the People API quota. */
const MAX_LOOKUPS = 40;

/** After a permission error (scope not granted yet, API disabled), back off. */
let disabledUntil = 0;

export type PhotoMap = Record<string, string | null>;

function domainOf(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Cached profile photos for `emails`. Anything missing or stale is looked up
 * in the Google Workspace directory after the response is sent, so pages never
 * wait on Google; the photo shows from the next render on.
 */
export async function photosFor(emails: (string | null | undefined)[]): Promise<PhotoMap> {
  const wanted = [
    ...new Set(emails.filter((e): e is string => !!e).map((e) => e.toLowerCase())),
  ];
  if (!wanted.length) return {};

  const rows = await db
    .select()
    .from(people)
    .where(inArray(people.email, wanted));

  const map: PhotoMap = {};
  const fresh = new Set<string>();
  for (const r of rows) {
    map[r.email] = r.photoUrl;
    if (Date.now() - r.fetchedAt.getTime() < STALE_MS) fresh.add(r.email);
  }

  const todo = wanted.filter((e) => !fresh.has(e)).slice(0, MAX_LOOKUPS);
  if (todo.length && Date.now() > disabledUntil) {
    after(() => lookUp(todo).catch((err) => console.error("photo lookup failed", err)));
  }
  return map;
}

type DirectoryPerson = {
  names?: { displayName?: string }[];
  photos?: { url?: string; default?: boolean }[];
};

async function lookUp(emails: string[]) {
  const domain = domainOf(env.gmailMailbox);
  const { auth } = await googleAuthFor();

  for (const email of emails) {
    let name: string | null = null;
    let photoUrl: string | null = null;

    // Only the school's own directory has photos; everyone else gets initials.
    if (domainOf(email) === domain) {
      try {
        const { data } = await auth.request<{ people?: DirectoryPerson[] }>({
          url: "https://people.googleapis.com/v1/people:searchDirectoryPeople",
          params: {
            query: email,
            readMask: "names,photos",
            sources: "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
            pageSize: 1,
          },
        });
        const person = data.people?.[0];
        name = person?.names?.[0]?.displayName ?? null;
        const photo = person?.photos?.find((p) => p.url && !p.default);
        // Ask for a crisp 96px square instead of Google's default size.
        photoUrl = photo?.url ? photo.url.replace(/=s\d+(-c)?$/, "") + "=s96-c" : null;
      } catch (err) {
        const status = (err as { status?: number; response?: { status?: number } })
          ?.response?.status;
        if (status === 403 || status === 401) {
          disabledUntil = Date.now() + 10 * 60 * 1000;
          console.warn(
            "People API refused the lookup. Enable the People API and reconnect Gmail at /admin/gmail to grant directory access.",
          );
          return;
        }
        throw err;
      }
    }

    await db
      .insert(people)
      .values({ email, name, photoUrl, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: people.email,
        set: { name, photoUrl, fetchedAt: sql`now()` },
      });
  }
}
