CREATE TABLE "csat_surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"token" text NOT NULL,
	"requester_email" text NOT NULL,
	"agent_id" uuid,
	"rating" text,
	"comment" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "csat_surveys_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "csat_surveys" ADD CONSTRAINT "csat_surveys_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csat_surveys" ADD CONSTRAINT "csat_surveys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "csat_ticket_idx" ON "csat_surveys" USING btree ("ticket_id","sent_at");