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

  const res = await get(url);
  // Only the route's own JSON 404 means "no such person"; a page-level 404 means
  // the route isn't deployed, which should be retried rather than cached.
  const json = res.headers.get("content-type")?.includes("application/json");
  if (res.status === 404 && json) return null;
  if (!res.ok || !json) throw new RosterError(res.status, blockedBy(res));
  return (await res.json()) as RosterPerson;
}

/** "www.roster.example.org" and "roster.example.org" are the same site. */
function sameSite(a: string, b: string) {
  return a.replace(/^www\./, "") === b.replace(/^www\./, "");
}

/**
 * fetch drops the Authorization header when it follows a redirect to another
 * host, and roster.example.org redirects to www.roster.example.org. So redirects are
 * followed here, re-sending the key only within the same site.
 */
async function get(url: URL, hops = 0): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.rosterApiKey}` },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location && hops < 3) {
    const next = new URL(location, url);
    if (next.protocol === "https:" && sameSite(next.hostname, url.hostname)) {
      return get(next, hops + 1);
    }
  }
  return res;
}

/**
 * Who answered, when it wasn't Roster's route: Cloudflare and Vercel's firewall
 * each mark their own blocks, which is the difference between a wrong key and
 * a bot rule that needs an exception.
 */
function blockedBy(res: Response) {
  const h = res.headers;
  const parts = [
    h.get("cf-mitigated") && `cloudflare ${h.get("cf-mitigated")}`,
    h.get("x-vercel-mitigated") && `vercel firewall ${h.get("x-vercel-mitigated")}`,
    h.get("server") && `server ${h.get("server")}`,
    h.get("cf-ray") && `cf-ray ${h.get("cf-ray")}`,
  ].filter(Boolean);
  return parts.join(", ");
}

export class RosterError extends Error {
  constructor(
    readonly status: number,
    detail = "",
  ) {
    super(`Roster /api/people answered ${status}${detail ? ` (${detail})` : ""}`);
  }
}

export function rosterDisplayName(p: RosterPerson) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || null;
}
