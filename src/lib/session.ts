/**
 * The app's own sign-in session: a signed cookie holding the email the
 * identity provider vouched for. Shared by proxy.ts and lib/auth.ts; no DB.
 */
import { jwtVerify, SignJWT } from "jose";
import { env } from "./env";

export const SESSION_COOKIE = "session";
/** How long a sign-in lasts before the identity provider is asked again. */
export const SESSION_MAX_AGE = 12 * 60 * 60;

/** Sign-in is on once an identity provider is set; until then only DEV_BYPASS_EMAIL works. */
export function signInConfigured() {
  return !!env.oidcIssuer && !!env.oidcClientId;
}

function key() {
  return new TextEncoder().encode(env.sessionSecret);
}

export function createSessionToken(email: string) {
  return new SignJWT({ email: email.toLowerCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(key());
}

/** The signed-in email, or null for a missing, expired or forged cookie. */
export async function readSessionToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const secret = key();
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return typeof payload.email === "string" && payload.email ? payload.email : null;
  } catch {
    return null;
  }
}

export function sessionCookie(maxAge = SESSION_MAX_AGE) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
