CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('none', 'p0', 'p1', 'p2', 'p3');--> statement-breakpoint
CREATE TABLE "people" (
	"email" text PRIMARY KEY NOT NULL,
	"name" text,
	"photo_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_assignees" (
	"ticket_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_stars" (
	"agent_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_assignee_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "bcc_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "priority" "ticket_priority" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_stars" ADD CONSTRAINT "ticket_stars_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_stars" ADD CONSTRAINT "ticket_stars_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_assignees_key" ON "ticket_assignees" USING btree ("ticket_id","agent_id");--> statement-breakpoint
CREATE INDEX "ticket_assignees_agent_idx" ON "ticket_assignees" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_stars_key" ON "ticket_stars" USING btree ("agent_id","ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_stars_ticket_idx" ON "ticket_stars" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_subject_trgm_idx" ON "tickets" USING gin ("subject" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tickets_requester_trgm_idx" ON "tickets" USING gin ((coalesce("requester_name", '') || ' ' || "requester_email") gin_trgm_ops);--> statement-breakpoint
-- Carry existing single assignees over before the column goes.
INSERT INTO "ticket_assignees" ("ticket_id", "agent_id")
SELECT "id", "assignee_id" FROM "tickets" WHERE "assignee_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "tickets" DROP COLUMN "assignee_id";