/**
 * Every reply carries the ticket number in its subject, e.g.
 * "[TICKET: #1058] Copies of CC notes from this week". Incoming mail with the
 * tag lands on that ticket even when the threading headers are missing.
 */
const TAG_RE = /\[TICKET:\s*#(\d+)\]\s*/i;

export function taggedSubject(number: number, subject: string) {
  return `[TICKET: #${number}] ${stripTicketTag(subject)}`;
}

export function ticketNumberFromSubject(subject: string | null | undefined): number | null {
  const m = subject?.match(TAG_RE);
  return m ? Number(m[1]) : null;
}

export function stripTicketTag(subject: string) {
  return subject.replace(TAG_RE, "").trim();
}

/** Subject markers for our own automated mail; ingest ignores replies to it. */
export const DIGEST_TAG = "[helpdesk digest]";
export const NOTICE_TAG = "[helpdesk notice]";

export function isDigestSubject(subject: string | null | undefined) {
  const s = subject?.toLowerCase() ?? "";
  return s.includes(DIGEST_TAG.toLowerCase()) || s.includes(NOTICE_TAG.toLowerCase());
}
