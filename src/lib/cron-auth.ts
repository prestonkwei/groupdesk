import { env } from "./env";

/**
 * Cron routes are reachable without signing in (see proxy.ts), so they carry
 * their own shared secret. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; external schedulers can use either
 * that or `?secret=`.
 */
export function cronAuthorized(req: Request): boolean {
  const expected = env.cronSecret;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${expected}`) return true;
  if (req.headers.get("x-cron-secret") === expected) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === expected;
}
