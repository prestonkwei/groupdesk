-- Custom SQL migration file.
-- Every time the portal shows or measures comes from the emails themselves,
-- not from when a row happened to be written. Recompute from the messages.

-- Opened = the first email in the ticket.
UPDATE "tickets" t SET "created_at" = m.first_at
FROM (SELECT "ticket_id", min("sent_at") AS first_at FROM "messages" GROUP BY "ticket_id") m
WHERE m."ticket_id" = t."id" AND m.first_at < t."created_at";--> statement-breakpoint

-- Last message = the newest email (internal notes don't count).
UPDATE "tickets" t SET "last_message_at" = m.last_at
FROM (
  SELECT "ticket_id", max("sent_at") AS last_at FROM "messages"
  WHERE "direction" <> 'note' GROUP BY "ticket_id"
) m
WHERE m."ticket_id" = t."id" AND m.last_at IS DISTINCT FROM t."last_message_at";--> statement-breakpoint

-- The "created" activity entry sits at the email's time on the timeline.
UPDATE "events" e SET "created_at" = t."created_at"
FROM "tickets" t
WHERE e."ticket_id" = t."id" AND e."kind" = 'created' AND e."created_at" > t."created_at";
