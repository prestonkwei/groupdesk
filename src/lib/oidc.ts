import "server-only";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "./env";

/**
 * Sign-in with any OpenID Connect provider: authorization code flow with PKCE,
 * the ID token verified against the provider's published keys. Only the email
 * is kept; lib/auth.ts decides whether that person is an agent.
 */

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
};

let cached:
  | { issuer: string; doc: Discovery; keys: ReturnType<typeof createRemoteJWKSet> }
  | undefined;

async function provider() {
  const issuer = env.oidcIssuer;
  if (cached?.issuer === issuer) return cached;

  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`OIDC discovery for ${issuer} answered ${res.status}`);
  const doc = (await res.json()) as Discovery;
  cached = { issuer, doc, keys: createRemoteJWKSet(new URL(doc.jwks_uri)) };
  return cached;
}

export function redirectUri() {
  return `${env.appUrl}/api/auth/callback`;
}

export async function authorizationUrl(flow: { state: string; nonce: string; verifier: string }) {
  const { doc } = await provider();
  const url = new URL(doc.authorization_endpoint);
  const params = {
    response_type: "code",
    client_id: env.oidcClientId,
    redirect_uri: redirectUri(),
    scope: env.oidcScopes,
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"),
    code_challenge_method: "S256",
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

type Claims = { sub?: string; email?: unknown; email_verified?: unknown };

/** Trade the callback's code for a verified email address. Throws with a readable reason. */
export async function signIn(code: string, flow: { nonce: string; verifier: string }) {
  const { doc, keys } = await provider();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: flow.verifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  const id = env.oidcClientId;
  const secret = env.oidcClientSecret;
  const methods = doc.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
  if (!secret) {
    body.set("client_id", id);
  } else if (methods.includes("client_secret_basic")) {
    const pair = `${encodeURIComponent(id)}:${encodeURIComponent(secret)}`;
    headers.authorization = `Basic ${Buffer.from(pair).toString("base64")}`;
  } else {
    body.set("client_id", id);
    body.set("client_secret", secret);
  }

  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const tokens = (await res.json().catch(() => ({}))) as {
    id_token?: string;
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !tokens.id_token) {
    const why = tokens.error_description ?? tokens.error;
    throw new Error(`The identity provider refused the sign-in (${res.status}${why ? `: ${why}` : ""})`);
  }

  const { payload } = await jwtVerify(tokens.id_token, keys, {
    issuer: doc.issuer,
    audience: id,
    clockTolerance: 60,
  });
  if (payload.nonce !== flow.nonce) throw new Error("The sign-in response didn't match this browser");

  let claims: Claims = payload;
  // Some providers only put the email in the userinfo response.
  if (!claims.email && doc.userinfo_endpoint && tokens.access_token) {
    const info = await fetch(doc.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const user = (await info.json().catch(() => ({}))) as Claims;
    if (info.ok && user.sub === payload.sub) claims = user;
  }

  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  if (!email.includes("@")) {
    throw new Error("The identity provider didn't share an email address. Include the email scope.");
  }
  if (claims.email_verified === false || claims.email_verified === "false") {
    throw new Error(`${email} isn't verified at the identity provider`);
  }
  return email;
}

/** Where to end the provider's own session too, if it supports that. */
export async function endSessionUrl() {
  const { doc } = await provider();
  if (!doc.end_session_endpoint) return null;
  const url = new URL(doc.end_session_endpoint);
  url.searchParams.set("client_id", env.oidcClientId);
  return url;
}
