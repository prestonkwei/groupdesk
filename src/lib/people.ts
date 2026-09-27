import "server-only";
import { after } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { env } from "@/lib/env";
import { googleAuthFor } from "@/lib/gmail/client";
import { RosterError, rosterDisplayName, rosterPerson } from "@/lib/roster";

/** How long a looked-up photo (or "no photo") is trusted before asking again. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** Lookups per request, so a long ticket list can't burn the People API quota. */
const MAX_LOOKUPS = 40;

/**
 * Rows cached before photos came from Roster hold Google directory photos; treat
 * them as stale so everyone switches over on their next render.
 */
const ROSTER_SINCE = new Date("2026-09-28T00:00:00Z").getTime();

/** After a permission error (scope not granted yet, API disabled), back off. */
let disabledUntil = 0;
let rosterDisabledUntil = 0;

export type PhotoMap = Record<string, string | null>;

function domainOf(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Cached profile photos for `emails`. Anything missing or stale is looked up
 * in Roster (falling back to the Google Workspace directory) after the response
 * is sent, so pages never wait on either; the photo shows from the next render on.
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
    const fetched = r.fetchedAt.getTime();
    if (fetched >= ROSTER_SINCE && Date.now() - fetched < STALE_MS) fresh.add(r.email);
  }

  const todo = wanted.filter((e) => !fresh.has(e)).slice(0, MAX_LOOKUPS);
  if (todo.length && (Date.now() > disabledUntil || Date.now() > rosterDisabledUntil)) {
    after(() => lookUp(todo).catch((err) => console.error("photo lookup failed", err)));
  }
  return map;
}

type DirectoryPerson = {
  names?: { displayName?: string }[];
  photos?: { url?: string; default?: boolean }[];
};

async function lookUp(emails: string[]) {
  for (const email of emails) {
    let name: string | null = null;
    let photoUrl: string | null = null;

    if (Date.now() > rosterDisabledUntil) {
      try {
        const person = await rosterPerson(email);
        if (person) {
          name = rosterDisplayName(person);
          photoUrl = person.imageUrl;
        }
      } catch (err) {
        if (err instanceof RosterError && (err.status === 401 || err.status === 503)) {
          rosterDisabledUntil = Date.now() + 10 * 60 * 1000;
          console.warn(
            "Roster refused the people lookup. Check ROSTER_API_KEY here matches PEOPLE_API_KEY in Roster.",
          );
        } else {
          console.error("Roster people lookup failed", err);
        }
        // Don't cache a miss we only got because Roster was unreachable.
        continue;
      }
    } else {
      continue;
    }

    if (!photoUrl) {
      const google = await googlePhoto(email);
      if (google === undefined) continue;
      name ??= google.name;
      photoUrl = google.photoUrl;
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

/**
 * The Workspace directory photo, for people Roster has no photo for. Resolves
 * undefined when the lookup should be retried later rather than cached.
 */
async function googlePhoto(
  email: string,
): Promise<{ name: string | null; photoUrl: string | null } | undefined> {
  // Only the school's own directory has photos; everyone else gets initials.
  if (domainOf(email) !== domainOf(env.gmailMailbox)) return { name: null, photoUrl: null };
  if (Date.now() <= disabledUntil) return { name: null, photoUrl: null };

  const { auth } = await googleAuthFor();
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
    const photo = person?.photos?.find((p) => p.url && !p.default);
    return {
      name: person?.names?.[0]?.displayName ?? null,
      // Ask for a crisp 96px square instead of Google's default size.
      photoUrl: photo?.url ? photo.url.replace(/=s\d+(-c)?$/, "") + "=s96-c" : null,
    };
  } catch (err) {
    const status = (err as { status?: number; response?: { status?: number } })
      ?.response?.status;
    if (status === 403 || status === 401) {
      disabledUntil = Date.now() + 10 * 60 * 1000;
      console.warn(
        "People API refused the lookup. Enable the People API and reconnect Gmail at /admin/gmail to grant directory access.",
      );
      return { name: null, photoUrl: null };
    }
    console.error("Google directory lookup failed", err);
    return undefined;
  }
}
