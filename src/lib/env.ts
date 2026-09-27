function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  get appUrl() {
    // Vercel sets VERCEL_PROJECT_PRODUCTION_URL (host only) on every deploy, so
    // a missing APP_URL no longer sends OAuth back to localhost in production.
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const fallback = vercel ? `https://${vercel}` : "http://localhost:3000";
    return opt("APP_URL", fallback).replace(/\/$/, "");
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
    return opt("GMAIL_LABEL_NAME", "helpdesk");
  },
  /** The one mailbox the app ingests from; only this person may manage it. */
  get gmailMailbox() {
    return opt("GMAIL_MAILBOX", "admin@example.org").toLowerCase();
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

  // Roster (photos, names, grad years)
  get rosterApiUrl() {
    return opt("ROSTER_API_URL", "https://roster.example.org").replace(/\/$/, "");
  },
  get rosterApiKey() {
    return opt("ROSTER_API_KEY");
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
