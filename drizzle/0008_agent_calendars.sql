CREATE TABLE "agent_calendars" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_calendars" ADD CONSTRAINT "agent_calendars_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;