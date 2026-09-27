CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"body_html" text NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Disposable heartbeat rows: skip the WAL.
CREATE UNLOGGED TABLE "ticket_presence" (
	"ticket_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"replying" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gmail_sync" ADD COLUMN "last_catchup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "imported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_agents_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_updated_by_agents_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_presence" ADD CONSTRAINT "ticket_presence_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_presence" ADD CONSTRAINT "ticket_presence_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "templates_name_idx" ON "templates" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_presence_key" ON "ticket_presence" USING btree ("ticket_id","agent_id");--> statement-breakpoint
-- Backfilled tickets were saved long after their first email was sent; live
-- mail lands within seconds. Flag the former so reports can leave them out.
UPDATE "tickets" t SET "imported" = true
FROM (SELECT "ticket_id", min("sent_at") AS first_at FROM "messages" GROUP BY "ticket_id") m
WHERE m."ticket_id" = t."id" AND m.first_at < t."created_at" - interval '1 hour';--> statement-breakpoint
-- "Opened" was the moment of import, not when the email came in. Use the
-- first message's time instead, so ages and response times mean something.
UPDATE "tickets" t SET "created_at" = m.first_at
FROM (SELECT "ticket_id", min("sent_at") AS first_at FROM "messages" GROUP BY "ticket_id") m
WHERE m."ticket_id" = t."id" AND m.first_at < t."created_at";