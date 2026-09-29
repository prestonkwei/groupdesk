import { NextResponse } from "next/server";
import { APP_NAME } from "@/lib/utils";

/** State, nonce and PKCE verifier for one sign-in, kept between login and callback. */
export const FLOW_COOKIE = "oidc_flow";
export const FLOW_COOKIE_PATH = "/api/auth";

export type Flow = { state: string; nonce: string; verifier: string; next: string };

export function parseFlow(value: string | undefined): Flow | null {
  if (!value) return null;
  try {
    const f = JSON.parse(value) as Partial<Flow>;
    return f.state && f.nonce && f.verifier ? { next: "/", ...f } as Flow : null;
  } catch {
    return null;
  }
}

/** Only same-site paths, so the sign-in can't be used as an open redirect. */
export function safeNext(value: string | null | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : "/";
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A bare page for sign-in errors and "signed out", outside the portal layout. */
export function authPage(title: string, message: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · ${escape(APP_NAME)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:28rem;margin:15vh auto;padding:0 1rem;color:#111}
h1{font-size:1rem}p{color:#555}a{color:#2563eb}</style></head>
<body><h1>${escape(title)}</h1><p>${escape(message)}</p><p><a href="/">Sign in</a></p></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
