import "server-only";
import { randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { after } from "next/server";
import {
  agents,
  blockedSenders,
  csatSurveys,
  events,
  messages,
  ticketAssignees,
  tickets,
  type Agent,
} from "@/db/schema";
import { notifyCsat } from "@/lib/notify";
import { env } from "@/lib/env";
import { sendTicketNotice } from "@/lib/gmail/send";
import { firstNameOf } from "@/lib/template-vars";
import { TEAM_NAME } from "@/lib/utils";

/** Solved tickets with no email in this long get no survey (bulk clean-ups of old mail). */
const MAX_AGE_DAYS = 30;
/** Solving the same ticket again within this window doesn't send a second survey. */
const RESEND_AFTER_HOURS = 24;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Add a line to the ticket's activity and bump updatedAt so open pages refresh. */
async function note(ticketId: string, kind: string, data: Record<string, unknown>) {
  await db.insert(events).values({ ticketId, kind, data });
  await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, ticketId));
}

/**
 * Email the requester a 👍/👎 survey for each ticket that was just solved.
 * Skipped when we never replied, the last email is old, the requester is one
 * of us / an automated sender / blocked, or a survey went out very recently;
 * the reason shows in the ticket's activity. Failures are logged there too,
 * never thrown: solving must not depend on email.
 */
export async function sendCsatSurveys(ticketIds: string[], solvedBy: Agent | null) {
  if (!ticketIds.length || process.env.CSAT_DISABLED === "1") return;

  const since = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000);
  const recent = new Date(Date.now() - RESEND_AFTER_HOURS * 3_600_000);
  // Subqueries name "tickets"."id" in full: in a single-table select Drizzle
  // writes ${tickets.id} as a bare "id", which inside "from messages m" means m.id.
  const rows = await db
    .select({
      ticket: tickets,
      replied: sql<boolean>`exists (select 1 from ${messages} m where m.ticket_id = "tickets"."id" and m.direction = 'outbound')`,
      surveyedRecently: sql<boolean>`exists (select 1 from ${csatSurveys} c where c.ticket_id = "tickets"."id" and c.sent_at > ${recent})`,
      isAgent: sql<boolean>`exists (select 1 from ${agents} a where lower(a.email) = lower("tickets"."requester_email"))`,
      isBlocked: sql<boolean>`exists (select 1 from ${blockedSenders} b where lower(b.email) = lower("tickets"."requester_email"))`,
    })
    .from(tickets)
    .where(inArray(tickets.id, ticketIds));

  for (const { ticket, replied, surveyedRecently, isAgent, isBlocked } of rows) {
    // Reopened (or merged) again before we got here: nothing to say.
    if (ticket.status !== "solved" || ticket.mergedIntoId) continue;
    const email = ticket.requesterEmail.toLowerCase();
    const skip = surveyedRecently
      ? `one already went out in the last ${RESEND_AFTER_HOURS} hours`
      : !replied
        ? "no reply was ever sent on this ticket"
        : ticket.lastMessageAt < since
          ? `the last email is over ${MAX_AGE_DAYS} days old`
          : isAgent
            ? `${email} is on the team`
            : isBlocked
              ? `${email} is blocked`
              : email === env.groupEmail.toLowerCase() ||
                  /(^|[.+_-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?)@/i.test(email)
                ? `${email} is an automated address`
                : null;
    if (skip) {
      await note(ticket.id, "csat_skipped", { reason: skip });
      continue;
    }
    try {
      await sendOne(ticket, solvedBy);
    } catch (err) {
      console.error(`csat: failed to send for #${ticket.number}`, err);
      const message = err instanceof Error ? err.message : String(err);
      await note(ticket.id, "csat_failed", { error: message.slice(0, 300) }).catch(() => {});
    }
  }
}

async function sendOne(ticket: typeof tickets.$inferSelect, solvedBy: Agent | null) {
  const token = randomBytes(18).toString("base64url");
  const link = (r: "good" | "bad") => `${env.appUrl}/csat/${token}?r=${r}`;
  const first = firstNameOf(ticket.requesterName, ticket.requesterEmail);
  const hi = first ? `Hi ${first},` : "Hi,";

  const button = (r: "good" | "bad", emoji: string, label: string) =>
    `<a href="${link(r)}" style="display:inline-block;margin-right:8px;padding:10px 18px;border:1px solid #d1d5db;border-radius:8px;background:#ffffff;color:#111827;text-decoration:none;font-size:22px;line-height:1" title="${label}" aria-label="${label}">${emoji}</a>`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2328">
<div>${esc(hi)}</div>
<div><br></div>
<div>We hope we were able to resolve your issue. This ticket will be closed now; just reply to this email if you still need help.</div>
<div><br></div>
<div>Please let us know how we did:</div>
<div style="margin:12px 0 4px">${button("good", "👍", "Good")}${button("bad", "👎", "Not good")}</div>
<p style="margin-top:16px;color:#6b7280">--<br>${TEAM_NAME}<br>Ticket #${ticket.number}</p>
</div>`;
  const text = [
    hi,
    "",
    "We hope we were able to resolve your issue. This ticket will be closed now; just reply to this email if you still need help.",
    "",
    "Please let us know how we did:",
    `👍 Good: ${link("good")}`,
    `👎 Not good: ${link("bad")}`,
    "",
    "--",
    TEAM_NAME,
    `Ticket #${ticket.number}`,
  ].join("\n");

  // Recorded only once it's sent, so a failed send can be retried by solving again.
  await sendTicketNotice({ ticket, kind: "csat", fromName: solvedBy?.name ?? TEAM_NAME, html, text });
  await db.insert(csatSurveys).values({
    ticketId: ticket.id,
    token,
    requesterEmail: ticket.requesterEmail,
    agentId: solvedBy?.id ?? null,
  });
  await note(ticket.id, "csat_sent", { to: ticket.requesterEmail });
}

export type CsatRating = "good" | "bad";

/** Record a click or a comment from the survey page. Returns false for an unknown token. */
export async function recordCsat(token: string, rating: CsatRating, comment?: string) {
  const [survey] = await db.select().from(csatSurveys).where(eq(csatSurveys.token, token)).limit(1);
  if (!survey) return false;
  const text = comment?.trim().slice(0, 5000) || null;
  if (survey.rating === rating && (!text || text === survey.comment)) return true;

  await db
    .update(csatSurveys)
    .set({ rating, respondedAt: new Date(), ...(text ? { comment: text } : {}) })
    .where(eq(csatSurveys.id, survey.id));
  await note(survey.ticketId, "csat", {
    rating,
    ...(text ? { comment: text } : {}),
    by: survey.requesterEmail,
  });

  // A 👎 or a comment is worth a heads-up; a plain 👍 just shows in reports.
  if (rating === "bad" || (text && text !== survey.comment)) {
    after(async () => {
      const [ticket] = await db.select().from(tickets).where(eq(tickets.id, survey.ticketId)).limit(1);
      if (!ticket) return;
      const assigned = await db
        .select({ id: ticketAssignees.agentId })
        .from(ticketAssignees)
        .where(eq(ticketAssignees.ticketId, ticket.id));
      const ids = [...assigned.map((a) => a.id), ...(survey.agentId ? [survey.agentId] : [])];
      await notifyCsat(ticket, ids, ticket.requesterName ?? survey.requesterEmail, rating, text ?? survey.comment);
    });
  }
  return true;
}

export async function surveyByToken(token: string) {
  const [row] = await db
    .select({
      rating: csatSurveys.rating,
      comment: csatSurveys.comment,
      number: tickets.number,
      subject: tickets.subject,
    })
    .from(csatSurveys)
    .innerJoin(tickets, eq(tickets.id, csatSurveys.ticketId))
    .where(eq(csatSurveys.token, token))
    .limit(1);
  return row ?? null;
}
