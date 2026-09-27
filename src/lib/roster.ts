import "server-only";
import { env } from "@/lib/env";

export type RosterPerson = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** "faculty" or a graduation year such as "2027". */
  gradYear: string | null;
  imageUrl: string | null;
};

/** Roster only knows school accounts; anything else would be a wasted 400. */
const SCHOOL_DOMAINS = ["example.org", "example.net"];

export function isSchoolEmail(email: string) {
  return SCHOOL_DOMAINS.includes(email.split("@")[1]?.toLowerCase() ?? "");
}

export function rosterConfigured() {
  return !!env.rosterApiKey;
}

/**
 * One person from Roster's /api/people, or null when Roster has no account for
 * them. Throws on anything else (network, bad key, 5xx) so callers can retry
 * later instead of caching a miss.
 */
export async function rosterPerson(email: string): Promise<RosterPerson | null> {
  if (!rosterConfigured() || !isSchoolEmail(email)) return null;

  const url = new URL("/api/people", env.rosterApiUrl);
  url.searchParams.set("email", email.toLowerCase());

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.rosterApiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new RosterError(res.status);
  return (await res.json()) as RosterPerson;
}

export class RosterError extends Error {
  constructor(readonly status: number) {
    super(`Roster /api/people answered ${status}`);
  }
}

export function rosterDisplayName(p: RosterPerson) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || null;
}
