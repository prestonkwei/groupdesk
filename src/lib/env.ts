/**
 * Read a variable, forgiving the usual paste mistakes in the Vercel UI: the
 * whole `NAME=value` line pasted as the value, surrounding quotes, or stray
 * whitespace. (APP_URL once arrived as "APP_URL=https://…" and broke links.)
 */
function read(name: string): string | undefined {
  let v = process.env[name]?.trim();
  if (!v) return undefined;
  if (v.toUpperCase().startsWith(`${name.toUpperCase()}=`)) v = v.slice(name.length + 1).trim();
  if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1).trim();
  return v || undefined;
}

function req(name: string): string {
  const v = read(name);
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function opt(name: string, fallback = ""): string {
  return read(name) ?? fallback;
}

/** A clean origin like "https://tickets.example.org", or null if unusable. */
function origin(value: string | undefined): string | null {
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^https?:?\/*/i, "")}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") || u.hostname === "localhost" ? `${u.protocol}//${u.host}` : null;
  } catch {
    return null;
  }
}

export const env = {
  get appUrl() {
    // Vercel sets VERCEL_PROJECT_PRODUCTION_URL (host only) on every deploy, so
    // a missing APP_URL no longer sends OAuth back to localhost in production.
    // A malformed APP_URL falls back rather than producing broken links.
    return (
      origin(read("APP_URL")) ??
      origin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
      "http://localhost:3000"
    );
  },

  // Google OAuth
  get googleClientId() {
    return req("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return req("GOOGLE_CLIENT_SECRET");
  },
  get googleRedirectUri() {
    return opt(
      "GOOGLE_REDIRECT_URI",
      `${this.appUrl}/api/admin/gmail/callback`,
    );
  },

  // Pub/Sub
  get pubsubTopic() {
    return req("GMAIL_PUBSUB_TOPIC");
  },
  get pushAudience() {
    return opt("GMAIL_PUSH_AUDIENCE", `${this.appUrl}/api/gmail/push`);
  },
  get pushServiceAccount() {
    return req("GMAIL_PUSH_SA_EMAIL");
  },

  // Gmail
  get labelName() {
    return req("GMAIL_LABEL_NAME");
  },
  /** The one mailbox the app ingests from; only this person may manage it. */
  get gmailMailbox() {
    return req("GMAIL_MAILBOX").toLowerCase();
  },
  get groupEmail() {
    return req("GROUP_EMAIL");
  },

  // Secrets
  get tokenEncKey() {
    return req("TOKEN_ENC_KEY");
  },
  get cronSecret() {
    return req("CRON_SECRET");
  },

  // Cloudflare Access
  get cfTeamDomain() {
    return opt("CF_ACCESS_TEAM_DOMAIN");
  },
  get cfAud() {
    return opt("CF_ACCESS_AUD");
  },

  // Roster (optional: photos, names, grad years)
  get rosterApiUrl() {
    return opt("ROSTER_API_URL").replace(/\/$/, "");
  },
  get rosterApiKey() {
    return opt("ROSTER_API_KEY");
  },
  /** Domains Roster has accounts for; defaults to the mailbox's own domain. */
  get rosterDomains() {
    const list = opt("ROSTER_EMAIL_DOMAINS") || (read("GMAIL_MAILBOX")?.split("@")[1] ?? "");
    return list.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  },

  // Alerts
  get alertEmailTo() {
    return opt("ALERT_EMAIL_TO");
  },
  get slackWebhook() {
    return opt("SLACK_WEBHOOK_URL");
  },

  /** Local-dev escape hatch: acts as the signed-in agent when Access is absent. */
  get devBypassEmail() {
    return process.env.NODE_ENV === "production"
      ? ""
      : opt("DEV_BYPASS_EMAIL");
  },
};
