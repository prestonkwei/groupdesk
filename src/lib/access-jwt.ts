/**
 * Cloudflare Access JWT verification. Edge-safe: no node: imports, no DB.
 * Shared by middleware (edge) and lib/auth.ts (node).
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export const ACCESS_HEADER = "cf-access-jwt-assertion";
export const ACCESS_COOKIE = "CF_Authorization";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksFor = "";

function keySet(teamDomain: string) {
  if (!jwks || jwksFor !== teamDomain) {
    jwks = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
    );
    jwksFor = teamDomain;
  }
  return jwks;
}

export type AccessIdentity = { email: string; sub: string };

export function readAccessToken(req: {
  headers: { get(name: string): string | null };
  cookies?: { get(name: string): { value: string } | undefined };
}): string | null {
  const header = req.headers.get(ACCESS_HEADER);
  if (header) return header;
  const cookie = req.cookies?.get(ACCESS_COOKIE)?.value;
  return cookie ?? null;
}

export async function verifyAccessToken(
  token: string,
  opts: { teamDomain: string; aud: string },
): Promise<AccessIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, keySet(opts.teamDomain), {
      issuer: `https://${opts.teamDomain}`,
      audience: opts.aud,
    });
    const p = payload as JWTPayload & { email?: string };
    if (!p.email || !p.sub) return null;
    return { email: p.email.toLowerCase(), sub: p.sub };
  } catch {
    return null;
  }
}
